import { NextRequest, NextResponse } from "next/server";
import { guardCheckoutAuth } from "@/app/api/_lib/rbac";
import { sokoCheckoutTimer } from "@/app/api/_lib/sokoCheckoutTiming";
import { getSokoNeonSql } from "@/app/api/_lib/store/sokoNeon";
import { ensureSokoOrdersSchema } from "@/app/api/_lib/store/sokoOrdersDb";
import {
  listReusableSokoShippingQuotes,
  saveSokoShippingQuotes,
  sokoShippingAddressFingerprint,
  sokoShippingOriginFingerprint,
} from "@/app/api/_lib/sokoShippingQuotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHIPPO_URL = "https://api.goshippo.com";
const VEHICLE_QUOTE_URL =
  "https://carhauler247.com/api/public/v1/quote";

type JsonRecord = Record<string, unknown>;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

function clean(value: unknown, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function positive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? number
    : 0;
}

function countryCode(value: unknown) {
  const country = clean(value, 80).toUpperCase();

  const countries: Record<string, string> = {
    "UNITED STATES": "US",
    "UNITED STATES OF AMERICA": "US",
    "USA": "US",
    "US": "US",
    "CANADA": "CA",
    "CA": "CA",
    "BURUNDI": "BI",
    "BI": "BI",
    "TANZANIA": "TZ",
    "TZ": "TZ",
    "KENYA": "KE",
    "KE": "KE",
    "RWANDA": "RW",
    "RW": "RW",
    "UGANDA": "UG",
    "UG": "UG",
    "CONGO": "CD",
    "DR CONGO": "CD",
    "DEMOCRATIC REPUBLIC OF THE CONGO": "CD",
    "CD": "CD",
  };

  return countries[country] || (
    /^[A-Z]{2}$/.test(country)
      ? country
      : ""
  );
}

async function readJson(req: NextRequest) {
  const body = await req.json();

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw new Error("Invalid delivery request.");
  }

  return body as JsonRecord;
}

function database() {
  return getSokoNeonSql();
}

function quoteRequired(
  reason: string,
  fulfillmentType = "freight"
) {
  return reply({
    ok: true,
    mode: "quote_required",
    fulfillmentType,
    reason,
    rates: [],
  });
}

export async function POST(req: NextRequest) {
  const timer = sokoCheckoutTimer("delivery-rates");
  const auth = await guardCheckoutAuth(req);
  timer.stage("auth");
  if (auth instanceof NextResponse) return auth;
  void ensureSokoOrdersSchema().catch(() => {});

  try {
    const body = await readJson(req);
    timer.stage("body");
    const productId = clean(body.productId, 100);

    const address =
      body.address &&
      typeof body.address === "object" &&
      !Array.isArray(body.address)
        ? body.address as JsonRecord
        : {};

    if (!productId) {
      return reply(
        { ok: false, error: "Product is required." },
        400
      );
    }

    const sql = database();

    const products = await sql`
      SELECT id,seller_user_id,payload,status
      FROM soko_products
      WHERE id=${productId}
        AND status='Active'
      LIMIT 1
    ` as Array<{
      id: string;
      seller_user_id: string;
      payload: JsonRecord;
      status: string;
    }>;

    const product = products[0];
    timer.stage("product");

    if (!product) {
      return reply(
        { ok: false, error: "Product is unavailable." },
        404
      );
    }

    const payload = product.payload || {};
    const category = clean(payload.category, 50).toLowerCase();

    const fulfillment =
      payload.fulfillmentOptions &&
      typeof payload.fulfillmentOptions === "object" &&
      !Array.isArray(payload.fulfillmentOptions)
        ? payload.fulfillmentOptions as JsonRecord
        : {};

    const fulfillmentType = clean(
      fulfillment.type || (
        category === "vehicles"
          ? "freight"
          : "quote"
      ),
      30
    );

    if (
      fulfillmentType === "freight" ||
      category === "vehicles"
    ) {
      const from =
        fulfillment.addressFrom &&
        typeof fulfillment.addressFrom === "object" &&
        !Array.isArray(fulfillment.addressFrom)
          ? fulfillment.addressFrom as JsonRecord
          : {};

      const fromZip = clean(from.zip, 5);
      const toZip = clean(address.postalCode, 5);
      const vehicleType = clean(
        fulfillment.vehicleType || "sedan",
        20
      ).toLowerCase();

      if (
        !/^\d{5}$/.test(fromZip) ||
        !/^\d{5}$/.test(toZip)
      ) {
        return reply(
          {
            ok: false,
            code: "VEHICLE_ZIP_REQUIRED",
            error:
              "A valid 5-digit pickup and delivery ZIP is required.",
          },
          400
        );
      }

      if (
        ![
          "sedan",
          "suv",
          "pickup",
          "truck",
          "van",
          "minivan",
        ].includes(vehicleType)
      ) {
        return reply(
          {
            ok: false,
            error: "Vehicle type is not supported.",
          },
          400
        );
      }

      if (clean(payload.currency, 10) !== "USD") {
        return reply(
          {
            ok: false,
            error:
              "Automatic vehicle delivery currently requires USD.",
          },
          400
        );
      }

      if (countryCode(address.country) !== "US") {
        return reply(
          {
            ok: false,
            error:
              "Automatic vehicle transport currently supports United States addresses only.",
          },
          400
        );
      }

      const addressFp = sokoShippingAddressFingerprint({
        fullName: clean(address.fullName, 120),
        phone: clean(address.phone, 30),
        country: clean(address.country, 80),
        state: clean(address.state, 100),
        city: clean(address.city, 100),
        streetAddress: clean(address.streetAddress, 240),
        postalCode: clean(address.postalCode, 30),
      });
      const originFp = sokoShippingOriginFingerprint({
        fulfillmentType: "freight",
        from,
        vehicleType,
      });
      const cached = await listReusableSokoShippingQuotes({
        buyerUserId: auth.viewer.userId,
        productId,
        addressFp,
        originFp,
        fulfillmentType: "freight",
      });
      if (cached.length) {
        timer.stage("shipping_reuse", { kind: "freight", rates: cached.length });
        return reply({
          ok: true,
          mode: "live_rates",
          fulfillmentType: "freight",
          rates: cached.map((quote) => ({
            id: quote.rateId,
            shipmentId: quote.shipmentId,
            provider: quote.provider,
            service: quote.service,
            amount: quote.amount.toFixed(2),
            currency: quote.currency,
            estimatedDays: quote.estimatedDays,
          })),
        });
      }

      const vehicleResponse = await fetch(
        VEHICLE_QUOTE_URL +
          "?fromZip=" + encodeURIComponent(fromZip) +
          "&toZip=" + encodeURIComponent(toZip) +
          "&vehicleType=" + encodeURIComponent(vehicleType),
        {
          headers: {
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15000),
          cache: "no-store",
        }
      );

      const vehicleData = await vehicleResponse
        .json()
        .catch(() => ({})) as JsonRecord;

      const quote =
        vehicleData.quote &&
        typeof vehicleData.quote === "object" &&
        !Array.isArray(vehicleData.quote)
          ? vehicleData.quote as JsonRecord
          : {};

      const amount = positive(quote.price);
      const distance = positive(quote.distance);
      const durationTerms = clean(
        quote.estimatedDays,
        240
      );

      if (
        !vehicleResponse.ok ||
        vehicleData.success !== true ||
        !amount
      ) {
        console.error("SOKO_VEHICLE_QUOTE_ERROR", {
          status: vehicleResponse.status,
          vehicleType,
        });

        return reply(
          {
            ok: false,
            code: "VEHICLE_QUOTE_UNAVAILABLE",
            error:
              "Automatic vehicle delivery quote is temporarily unavailable.",
          },
          503
        );
      }

      timer.stage("shipping_live", { kind: "freight" });
      await saveSokoShippingQuotes([{
        rateId: "automatic-vehicle-transport",
        shipmentId: "",
        buyerUserId: auth.viewer.userId,
        productId,
        addressFp,
        originFp,
        amount,
        currency: "USD",
        provider: "CarHauler247",
        service: "Open vehicle transport",
        estimatedDays: null,
        fulfillmentType: "freight",
      }]);

      return reply({
        ok: true,
        mode: "live_rates",
        fulfillmentType: "freight",
        rates: [{
          id: "automatic-vehicle-transport",
          shipmentId: "",
          provider: "CarHauler247",
          service: "Open vehicle transport",
          amount: amount.toFixed(2),
          currency: "USD",
          estimatedDays: null,
          durationTerms,
          distanceMiles: distance || null,
          vehicleType,
          fromZip,
          toZip,
        }],
      });
    }

    if (fulfillmentType === "quote") {
      return reply(
        {
          ok: false,
          code: "AUTOMATIC_QUOTE_UNAVAILABLE",
          error:
            "Automatic delivery is not available for this item type.",
        },
        400
      );
    }

    if (fulfillmentType === "pickup") {
      return reply({
        ok: true,
        mode: "fixed",
        fulfillmentType: "pickup",
        rates: [{
          id: "pickup",
          provider: "Seller",
          service: "Local pickup",
          amount: "0.00",
          currency: clean(payload.currency, 10),
          estimatedDays: null,
        }],
      });
    }

    if (fulfillmentType === "local_delivery") {
      const flatFee = positive(fulfillment.flatFee);

      if (!flatFee) {
        return quoteRequired(
          "Seller has not entered a local delivery fee.",
          "local_delivery"
        );
      }

      return reply({
        ok: true,
        mode: "fixed",
        fulfillmentType: "local_delivery",
        rates: [{
          id: "seller-local-delivery",
          provider: "Seller",
          service: "Local delivery",
          amount: flatFee.toFixed(2),
          currency: clean(payload.currency, 10),
          estimatedDays: positive(
            fulfillment.estimatedDays
          ) || null,
        }],
      });
    }

    if (fulfillmentType !== "parcel") {
      return quoteRequired(
        "Delivery method has not been configured by the seller."
      );
    }

    const from =
      fulfillment.addressFrom &&
      typeof fulfillment.addressFrom === "object" &&
      !Array.isArray(fulfillment.addressFrom)
        ? fulfillment.addressFrom as JsonRecord
        : {};

    const parcel =
      fulfillment.parcel &&
      typeof fulfillment.parcel === "object" &&
      !Array.isArray(fulfillment.parcel)
        ? fulfillment.parcel as JsonRecord
        : {};

    const destinationCountry = countryCode(address.country);
    const originCountry = countryCode(from.country);

    if (
      !clean(from.name, 120) ||
      !clean(from.street1, 240) ||
      !clean(from.city, 100) ||
      !clean(from.state, 100) ||
      !clean(from.zip, 30) ||
      !originCountry
    ) {
      return quoteRequired(
        "Seller shipping address is incomplete.",
        "parcel"
      );
    }

    if (
      !clean(address.fullName, 120) ||
      !clean(address.streetAddress, 240) ||
      !clean(address.city, 100) ||
      !clean(address.state, 100) ||
      !clean(address.postalCode, 30) ||
      !destinationCountry
    ) {
      return reply(
        {
          ok: false,
          error: "Complete a valid delivery address.",
        },
        400
      );
    }

    const length = positive(parcel.length);
    const width = positive(parcel.width);
    const height = positive(parcel.height);
    const weight = positive(parcel.weight);

    if (!length || !width || !height || !weight) {
      return quoteRequired(
        "Seller must add product weight and dimensions.",
        "parcel"
      );
    }

    const addressFp = sokoShippingAddressFingerprint({
      fullName: clean(address.fullName, 120),
      phone: clean(address.phone, 30),
      country: clean(address.country, 80),
      state: clean(address.state, 100),
      city: clean(address.city, 100),
      streetAddress: clean(address.streetAddress, 240),
      postalCode: clean(address.postalCode, 30),
    });
    const originFp = sokoShippingOriginFingerprint({
      fulfillmentType: "parcel",
      from,
      parcel,
    });
    const cached = await listReusableSokoShippingQuotes({
      buyerUserId: auth.viewer.userId,
      productId,
      addressFp,
      originFp,
      fulfillmentType: "parcel",
    });
    if (cached.length) {
      timer.stage("shipping_reuse", { kind: "parcel", rates: cached.length });
      return reply({
        ok: true,
        mode: "live_rates",
        fulfillmentType: "parcel",
        shipmentId: cached[0].shipmentId,
        rates: cached.map((quote) => ({
          id: quote.rateId,
          shipmentId: quote.shipmentId,
          provider: quote.provider,
          service: quote.service,
          amount: String(quote.amount),
          currency: quote.currency,
          estimatedDays: quote.estimatedDays,
        })),
      });
    }

    const token = clean(
      process.env.SHIPPO_API_TOKEN,
      300
    );

    if (!token) {
      return reply(
        {
          ok: false,
          code: "SHIPPO_NOT_CONFIGURED",
          error:
            "Live carrier rates are not configured yet.",
        },
        503
      );
    }

    const shippoResponse = await fetch(
      `${SHIPPO_URL}/shipments`,
      {
        method: "POST",
        headers: {
          Authorization: `ShippoToken ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address_from: {
            name: clean(from.name, 120),
            street1: clean(from.street1, 240),
            city: clean(from.city, 100),
            state: clean(from.state, 100),
            zip: clean(from.zip, 30),
            country: originCountry,
            phone: clean(from.phone, 30),
            email: clean(process.env.SHIPPO_FROM_EMAIL, 160),
          },
          address_to: {
            name: clean(address.fullName, 120),
            street1: clean(address.streetAddress, 240),
            city: clean(address.city, 100),
            state: clean(address.state, 100),
            zip: clean(address.postalCode, 30),
            country: destinationCountry,
            phone: clean(address.phone, 30),
          },
          parcels: [{
            length: String(length),
            width: String(width),
            height: String(height),
            distance_unit:
              clean(parcel.distanceUnit, 5) === "cm"
                ? "cm"
                : "in",
            weight: String(weight),
            mass_unit:
              clean(parcel.massUnit, 5) === "kg"
                ? "kg"
                : "lb",
          }],
          async: false,
        }),
        signal: AbortSignal.timeout(20000),
      }
    );

    const shippo = await shippoResponse
      .json()
      .catch(() => ({})) as JsonRecord;

    if (!shippoResponse.ok) {
      console.error("SOKO_SHIPPO_RATE_ERROR", {
        status: shippoResponse.status,
        productId,
      });

      return reply(
        {
          ok: false,
          error:
            "Carrier rates could not be calculated.",
        },
        502
      );
    }

    const rawRates = Array.isArray(shippo.rates)
      ? shippo.rates
      : [];

    const rates = rawRates
      .map((value) => {
        const rate =
          value &&
          typeof value === "object"
            ? value as JsonRecord
            : {};

        const provider =
          rate.provider &&
          typeof rate.provider === "object"
            ? rate.provider as JsonRecord
            : {};

        return {
          id: clean(rate.object_id, 120),
          provider: clean(
            provider.name || rate.provider,
            80
          ),
          service: clean(
            rate.servicelevel_name ||
            (
              rate.servicelevel &&
              typeof rate.servicelevel === "object"
                ? (
                    rate.servicelevel as JsonRecord
                  ).name
                : ""
            ),
            120
          ),
          amount: clean(rate.amount, 40),
          currency: clean(rate.currency, 10),
          estimatedDays:
            positive(rate.estimated_days) || null,
          durationTerms: clean(
            rate.duration_terms,
            240
          ),
        };
      })
      .filter((rate) =>
        rate.id &&
        positive(rate.amount)
      )
      .sort(
        (a, b) =>
          Number(a.amount) - Number(b.amount)
      )
      .slice(0, 10);

    if (!rates.length) {
      return quoteRequired(
        "No carrier is available for this address.",
        "parcel"
      );
    }

    const shipmentId = clean(shippo.object_id, 120);
    timer.stage("shipping_live", { kind: "parcel", rates: rates.length });
    await saveSokoShippingQuotes(
      rates.map((rate) => ({
        rateId: rate.id,
        shipmentId,
        buyerUserId: auth.viewer.userId,
        productId,
        addressFp,
        originFp,
        amount: Number(rate.amount),
        currency: rate.currency,
        provider: rate.provider,
        service: rate.service,
        estimatedDays: rate.estimatedDays,
        fulfillmentType: "parcel",
      }))
    );

    return reply({
      ok: true,
      mode: "live_rates",
      fulfillmentType: "parcel",
      shipmentId,
      rates,
    });
  } catch (error) {
    return reply(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not calculate delivery.",
      },
      400
    );
  }
}
