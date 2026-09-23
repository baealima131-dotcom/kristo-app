import type {
  NextRequest,
} from "next/server";

import {
  NextResponse,
} from "next/server";

import {
  guardAuth,
} from "@/app/api/_lib/rbac";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const revalidate =
  0;

const MAX_HTML_BYTES =
  2_000_000;

function fail(
  error: any
) {
  return NextResponse.json(
    {
      ok: false,

      error: String(
        error?.message ||
          "Could not read product preview."
      ),
    },
    {
      status:
        Number(
          error?.status
        ) || 400,
    }
  );
}

function allowedAlibabaHost(
  hostname: string
) {
  const host =
    hostname
      .trim()
      .toLowerCase();

  return (
    host ===
      "alibaba.com" ||
    host.endsWith(
      ".alibaba.com"
    )
  );
}

function parseAlibabaUrl(
  raw: string
) {
  let url: URL;

  try {
    url =
      new URL(raw);
  } catch {
    throw Object.assign(
      new Error(
        "Invalid Alibaba product link."
      ),
      {
        status: 400,
      }
    );
  }

  if (
    url.protocol !==
      "https:" ||
    !allowedAlibabaHost(
      url.hostname
    )
  ) {
    throw Object.assign(
      new Error(
        "Only HTTPS Alibaba product links are allowed."
      ),
      {
        status: 400,
      }
    );
  }

  return url;
}

function decodeHtml(
  value: string
) {
  return String(
    value || ""
  )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /&#x([0-9a-f]+);/gi,
      (
        _,
        value
      ) =>
        String.fromCodePoint(
          parseInt(
            value,
            16
          )
        )
    )
    .replace(
      /&#(\d+);/g,
      (
        _,
        value
      ) =>
        String.fromCodePoint(
          Number(value)
        )
    );
}

function attribute(
  tag: string,
  name: string
) {
  const escaped =
    name.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    );

  const match =
    tag.match(
      new RegExp(
        `${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
        "i"
      )
    );

  return decodeHtml(
    match?.[1] ||
      match?.[2] ||
      match?.[3] ||
      ""
  ).trim();
}

function metaContent(
  html: string,
  key: string
) {
  const tags =
    html.match(
      /<meta\b[^>]*>/gi
    ) || [];

  for (
    const tag of tags
  ) {
    const marker =
      attribute(
        tag,
        "property"
      ) ||
      attribute(
        tag,
        "name"
      ) ||
      attribute(
        tag,
        "itemprop"
      );

    if (
      marker
        .toLowerCase() ===
      key.toLowerCase()
    ) {
      return attribute(
        tag,
        "content"
      );
    }
  }

  return "";
}

function linkImage(
  html: string
) {
  const tags =
    html.match(
      /<link\b[^>]*>/gi
    ) || [];

  for (
    const tag of tags
  ) {
    const rel =
      attribute(
        tag,
        "rel"
      ).toLowerCase();

    const asValue =
      attribute(
        tag,
        "as"
      ).toLowerCase();

    if (
      rel ===
        "image_src" ||
      (
        rel ===
          "preload" &&
        asValue ===
          "image"
      )
    ) {
      const href =
        attribute(
          tag,
          "href"
        );

      if (href) {
        return href;
      }
    }
  }

  return "";
}

function jsonImage(
  html: string
) {
  const match =
    html.match(
      /"image"\s*:\s*(?:"([^"]+)"|\[\s*"([^"]+)")/i
    );

  return (
    match?.[1] ||
    match?.[2] ||
    ""
  );
}

function normalizeUrl(
  raw: string,
  base: string
) {
  if (!raw) {
    return "";
  }

  const cleaned =
    decodeHtml(raw)
      .replace(
        /\\u002f/gi,
        "/"
      )
      .replace(
        /\\\//g,
        "/"
      )
      .trim();

  try {
    const url =
      new URL(
        cleaned,
        base
      );

    if (
      url.protocol !==
        "https:" &&
      url.protocol !==
        "http:"
    ) {
      return "";
    }

    return url.toString();
  } catch {
    return "";
  }
}


async function validateImageUrl(
  rawUrl: string,
  baseUrl: string
) {
  const imageUrl =
    normalizeUrl(
      rawUrl,
      baseUrl
    );

  if (!imageUrl) {
    return "";
  }

  try {
    const parsed =
      new URL(
        imageUrl
      );

    if (
      parsed.protocol !==
        "https:" &&
      parsed.protocol !==
        "http:"
    ) {
      return "";
    }

    const response =
      await fetch(
        parsed.toString(),
        {
          method: "GET",

          redirect:
            "follow",

          cache:
            "no-store",

          headers: {
            Accept:
              "image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8",

            Referer:
              "https://www.alibaba.com/",

            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",

          },
        }
      );

    if (
      !response.ok &&
      response.status !==
        206
    ) {
      return "";
    }

    const contentType =
      String(
        response.headers.get(
          "content-type"
        ) || ""
      )
        .toLowerCase()
        .trim();

    const supported =
      contentType.startsWith(
        "image/jpeg"
      ) ||
      contentType.startsWith(
        "image/jpg"
      ) ||
      contentType.startsWith(
        "image/png"
      ) ||
      contentType.startsWith(
        "image/webp"
      ) ||
      contentType.startsWith(
        "image/gif"
      );

    if (!supported) {
      return "";
    }

    return imageUrl;
  } catch {
    return "";
  }
}

function unescapeAlibabaData(
  value: string
) {
  return decodeHtml(
    String(
      value || ""
    )
  )
    .replace(
      /\\u002[fF]/g,
      "/"
    )
    .replace(
      /\\u003[aA]/g,
      ":"
    )
    .replace(
      /\\u0026/g,
      "&"
    )
    .replace(
      /\\\//g,
      "/"
    );
}

function collectAlibabaImageCandidates(
  html: string
) {
  const text =
    unescapeAlibabaData(
      html
    );

  const output:
    string[] = [];

  const seen =
    new Set<string>();

  const add = (
    value: string
  ) => {
    const cleaned =
      unescapeAlibabaData(
        value
      ).trim();

    if (
      !cleaned ||
      seen.has(
        cleaned
      )
    ) {
      return;
    }

    const lower =
      cleaned.toLowerCase();

    if (
      lower.includes(
        "favicon"
      ) ||
      lower.includes(
        "logo"
      ) ||
      lower.includes(
        "sprite"
      ) ||
      lower.includes(
        "avatar"
      ) ||
      lower.includes(
        "loading"
      )
    ) {
      return;
    }

    seen.add(
      cleaned
    );

    output.push(
      cleaned
    );
  };

  const keyedPatterns = [
    /"(?:imageUrl|imageURL|mainImage|mainImageUrl|mainImageURL|originalImage|originalImageUrl|originalImageURL|imagePath|imagePathUrl|imagePathURL)"\s*:\s*"([^"]+)"/gi,

    /"(?:imagePathList|imageList|images|productImages)"\s*:\s*\[\s*"([^"]+)"/gi,
  ];

  for (
    const pattern
    of keyedPatterns
  ) {
    let match:
      RegExpExecArray | null;

    while (
      (
        match =
          pattern.exec(
            text
          )
      )
    ) {
      if (
        match[1]
      ) {
        add(
          match[1]
        );
      }

      if (
        output.length >=
        60
      ) {
        break;
      }
    }
  }

  const cdnPattern =
    /(?:https?:)?\/\/[^"'`\s<>\\]+?\.(?:jpe?g|png|webp)(?:_[^"'`\s<>\\]*)?/gi;

  const cdnMatches =
    text.match(
      cdnPattern
    ) || [];

  for (
    const value
    of cdnMatches
  ) {
    if (
      /alicdn\.com|alibabausercontent\.com/i.test(
        value
      )
    ) {
      add(value);
    }

    if (
      output.length >=
      80
    ) {
      break;
    }
  }

  return output;
}

function scoreAlibabaProductImageCandidate(
  value: string
) {
  const lower =
    unescapeAlibabaData(
      value
    ).toLowerCase();

  let score = 0;

  // Alibaba product gallery photos.
  if (
    lower.includes(
      "/kf/"
    )
  ) {
    score += 120;
  }

  if (
    lower.includes(
      "@sc04/kf/"
    )
  ) {
    score += 35;
  }

  // Large square product images are preferred.
  if (
    /_(?:800|900|960|1000)x(?:800|900|960|1000)/i.test(
      lower
    )
  ) {
    score += 45;
  }

  if (
    /_\d{3,4}x\d{3,4}/i.test(
      lower
    )
  ) {
    score += 10;
  }

  // Tiny thumbnails should not win.
  if (
    /_(?:40|50|60|80|100|120)x(?:40|50|60|80|100|120)/i.test(
      lower
    )
  ) {
    score -= 90;
  }

  // Alibaba UI / banner artwork.
  if (
    lower.includes(
      "/@img/imgextra/"
    )
  ) {
    score -= 120;
  }

  if (
    lower.includes(
      "-tps-"
    )
  ) {
    score -= 100;
  }

  return score;
}

async function pickValidatedProductImage(
  html: string,
  baseUrl: string
) {
  const candidates = [
    metaContent(
      html,
      "og:image"
    ),

    metaContent(
      html,
      "og:image:secure_url"
    ),

    metaContent(
      html,
      "twitter:image"
    ),

    metaContent(
      html,
      "twitter:image:src"
    ),

    metaContent(
      html,
      "image"
    ),

    jsonImage(
      html
    ),

    linkImage(
      html
    ),

    ...collectAlibabaImageCandidates(
      html
    ),
  ];

  const rankedCandidates =
    candidates
      .filter(Boolean)
      .map(
        (value, index) => ({
          value:
            String(value),
          index,
          score:
            scoreAlibabaProductImageCandidate(
              String(value)
            ),
        })
      )
      .sort(
        (a, b) =>
          b.score -
            a.score ||
          a.index -
            b.index
      )
      .map(
        (entry) =>
          entry.value
      );


  const diagnosticCandidates =
    rankedCandidates
      .filter(Boolean)
      .slice(
        0,
        20
      )
      .map(
        (value) =>
          String(value)
            .slice(
              0,
              500
            )
      );


  const seen =
    new Set<string>();

  for (
    const raw
    of rankedCandidates
  ) {
    if (!raw) {
      continue;
    }

    const normalized =
      normalizeUrl(
        raw,
        baseUrl
      );

    if (
      !normalized ||
      seen.has(
        normalized
      )
    ) {
      continue;
    }

    seen.add(
      normalized
    );

    const valid =
      await validateImageUrl(
        normalized,
        baseUrl
      );

    if (valid) {

      return valid;
    }
  }

  return "";
}

function pageTitle(
  html: string
) {
  const socialTitle =
    metaContent(
      html,
      "og:title"
    ) ||
    metaContent(
      html,
      "twitter:title"
    );

  if (socialTitle) {
    return socialTitle;
  }

  const title =
    html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i
    )?.[1];

  return decodeHtml(
    String(
      title || ""
    ).replace(
      /\s+/g,
      " "
    )
  ).trim();
}



function cleanAlibabaImportText(
  value: unknown,
  maxLength = 4000
) {
  return decodeHtml(
    unescapeAlibabaData(
      String(
        value || ""
      )
    )
  )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /\\n|\\r|\\t/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim()
    .slice(
      0,
      maxLength
    );
}

function escapeAlibabaKey(
  value: string
) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

function findAlibabaString(
  html: string,
  keys: string[]
) {
  const text =
    unescapeAlibabaData(
      html
    );

  for (
    const key
    of keys
  ) {
    const escaped =
      escapeAlibabaKey(
        key
      );

    const pattern =
      new RegExp(
        `"${escaped}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
        "i"
      );

    const match =
      text.match(
        pattern
      );

    if (
      !match?.[1]
    ) {
      continue;
    }

    let value =
      match[1];

    try {
      value =
        JSON.parse(
          `"${value}"`
        );
    } catch {
      value =
        value
          .replace(
            /\\"/g,
            '"'
          )
          .replace(
            /\\n|\\r|\\t/g,
            " "
          );
    }

    const cleaned =
      cleanAlibabaImportText(
        value
      );

    if (cleaned) {
      return cleaned;
    }
  }

  return "";
}

function findAlibabaNumber(
  html: string,
  keys: string[]
) {
  const text =
    unescapeAlibabaData(
      html
    );

  for (
    const key
    of keys
  ) {
    const escaped =
      escapeAlibabaKey(
        key
      );

    const pattern =
      new RegExp(
        `"${escaped}"\\s*:\\s*(?:"([^"]+)"|(\\d+(?:\\.\\d+)?))`,
        "i"
      );

    const match =
      text.match(
        pattern
      );

    const raw =
      String(
        match?.[1] ||
        match?.[2] ||
        ""
      )
        .replace(
          /,/g,
          ""
        );

    const numeric =
      raw.match(
        /\d+(?:\.\d+)?/
      )?.[0];

    if (!numeric) {
      continue;
    }

    const value =
      Number(
        numeric
      );

    if (
      Number.isFinite(
        value
      ) &&
      value > 0
    ) {
      return value;
    }
  }

  return 0;
}

function alibabaImageIdentity(
  value: string
) {
  try {
    const url =
      new URL(
        value
      );

    const pathname =
      decodeURIComponent(
        url.pathname
      );

    const kf =
      pathname.match(
        /\/kf\/([^/]+?\.(?:jpe?g|png|webp))/i
      );

    if (
      kf?.[1]
    ) {
      return (
        "kf:" +
        kf[1]
          .toLowerCase()
      );
    }

    return (
      url.hostname
        .toLowerCase() +
      pathname
        .replace(
          /_[^/]+$/i,
          ""
        )
        .toLowerCase()
    );
  } catch {
    return value
      .toLowerCase();
  }
}

function collectAlibabaProductImages(
  html: string,
  baseUrl: string,
  mainImage: string
) {
  const candidates = [
    mainImage,

    metaContent(
      html,
      "og:image"
    ),

    metaContent(
      html,
      "og:image:secure_url"
    ),

    metaContent(
      html,
      "twitter:image"
    ),

    metaContent(
      html,
      "twitter:image:src"
    ),

    jsonImage(
      html
    ),

    linkImage(
      html
    ),

    ...collectAlibabaImageCandidates(
      html
    ),
  ];

  const ranked =
    candidates
      .filter(
        Boolean
      )
      .map(
        (
          value,
          index
        ) => ({
          value:
            String(
              value
            ),
          index,
          score:
            scoreAlibabaProductImageCandidate(
              String(
                value
              )
            ),
        })
      )
      .sort(
        (a, b) =>
          b.score -
            a.score ||
          a.index -
            b.index
      );

  const images:
    string[] = [];

  const seen =
    new Set<string>();

  for (
    const row
    of ranked
  ) {
    const normalized =
      normalizeUrl(
        row.value,
        baseUrl
      );

    if (!normalized) {
      continue;
    }

    /*
     * /kf/ images are Alibaba product-gallery
     * photos. Avoid banners/UI artwork.
     */
    if (
      normalized !==
        mainImage &&
      row.score < 120
    ) {
      continue;
    }

    let host = "";

    try {
      host =
        new URL(
          normalized
        )
          .hostname
          .toLowerCase();
    } catch {
      continue;
    }

    const allowed =
      host ===
        "alicdn.com" ||
      host.endsWith(
        ".alicdn.com"
      ) ||
      host ===
        "alibabausercontent.com" ||
      host.endsWith(
        ".alibabausercontent.com"
      ) ||
      host ===
        "alibaba.com" ||
      host.endsWith(
        ".alibaba.com"
      );

    if (!allowed) {
      continue;
    }

    const identity =
      alibabaImageIdentity(
        normalized
      );

    if (
      seen.has(
        identity
      )
    ) {
      continue;
    }

    seen.add(
      identity
    );

    images.push(
      normalized
    );

    if (
      images.length >=
      30
    ) {
      break;
    }
  }

  if (
    mainImage &&
    !images.includes(
      mainImage
    )
  ) {
    images.unshift(
      mainImage
    );
  }

  return images.slice(
    0,
    30
  );
}

function extractAlibabaSpecifications(
  html: string
) {
  const text =
    unescapeAlibabaData(
      html
    );

  const output:
    Array<{
      name: string;
      value: string;
    }> = [];

  const seen =
    new Set<string>();

  const add = (
    rawName: string,
    rawValue: string
  ) => {
    const name =
      cleanAlibabaImportText(
        rawName,
        120
      );

    const value =
      cleanAlibabaImportText(
        rawValue,
        500
      );

    if (
      !name ||
      !value
    ) {
      return;
    }

    const identity =
      `${name.toLowerCase()}::${value.toLowerCase()}`;

    if (
      seen.has(
        identity
      )
    ) {
      return;
    }

    seen.add(
      identity
    );

    output.push({
      name,
      value,
    });
  };

  const patterns = [
    /"(?:attrName|attributeName|propertyName|specName)"\s*:\s*"([^"]+)"[\s\S]{0,300}?"(?:attrValue|attributeValue|propertyValue|propertyValueDisplayName|specValue)"\s*:\s*"([^"]+)"/gi,

    /"(?:attrValue|attributeValue|propertyValue|propertyValueDisplayName|specValue)"\s*:\s*"([^"]+)"[\s\S]{0,300}?"(?:attrName|attributeName|propertyName|specName)"\s*:\s*"([^"]+)"/gi,
  ];

  for (
    let index = 0;
    index <
      patterns.length;
    index += 1
  ) {
    let match:
      RegExpExecArray |
      null;

    while (
      (
        match =
          patterns[
            index
          ].exec(
            text
          )
      )
    ) {
      if (
        index === 0
      ) {
        add(
          match[1] ||
            "",
          match[2] ||
            ""
        );
      } else {
        add(
          match[2] ||
            "",
          match[1] ||
            ""
        );
      }

      if (
        output.length >=
        30
      ) {
        break;
      }
    }
  }

  return output;
}

function extractAlibabaProductDetails(
  html: string
) {
  const description =
    cleanAlibabaImportText(
      metaContent(
        html,
        "og:description"
      ) ||
      metaContent(
        html,
        "description"
      ) ||
      findAlibabaString(
        html,
        [
          "productDescription",
          "shortDescription",
          "description",
        ]
      ),
      4000
    );

  const supplierName =
    findAlibabaString(
      html,
      [
        "supplierName",
        "companyName",
        "sellerName",
        "storeName",
      ]
    );

  const currency =
    findAlibabaString(
      html,
      [
        "priceCurrency",
        "currencyCode",
        "currency",
      ]
    )
      .toUpperCase()
      .slice(
        0,
        8
      );

  let priceMin =
    findAlibabaNumber(
      html,
      [
        "lowPrice",
        "minPrice",
        "minimumPrice",
        "salePrice",
        "price",
      ]
    );

  let priceMax =
    findAlibabaNumber(
      html,
      [
        "highPrice",
        "maxPrice",
        "maximumPrice",
      ]
    );

  if (
    priceMin > 0 &&
    priceMax <= 0
  ) {
    priceMax =
      priceMin;
  }

  if (
    priceMax > 0 &&
    priceMin <= 0
  ) {
    priceMin =
      priceMax;
  }

  if (
    priceMin > 0 &&
    priceMax > 0 &&
    priceMin >
      priceMax
  ) {
    const temporary =
      priceMin;

    priceMin =
      priceMax;

    priceMax =
      temporary;
  }

  const moq =
    findAlibabaNumber(
      html,
      [
        "minimumOrderQuantity",
        "minOrderQuantity",
        "minOrderQty",
        "minimumOrder",
        "minOrder",
        "moq",
      ]
    );

  const sku =
    findAlibabaString(
      html,
      [
        "sku",
        "productCode",
        "modelNumber",
      ]
    );

  const specifications =
    extractAlibabaSpecifications(
      html
    );

  const variants =
    specifications
      .filter(
        (row) =>
          /color|colour|size|model|style|capacity|dimension/i.test(
            row.name
          )
      )
      .map(
        (row) => ({
          name:
            row.name,
          values: [
            row.value,
          ],
        })
      )
      .slice(
        0,
        15
      );

  return {
    description,
    supplierName,
    currency,
    priceMin,
    priceMax,
    moq,
    sku,
    specifications,
    variants,
  };
}

function extractAlibabaProductId(
  url: URL
) {
  const path =
    decodeURIComponent(
      url.pathname
    );

  const matches = [
    path.match(
      /[_-](\d{8,})\.html$/i
    ),
    path.match(
      /(\d{8,})\.html$/i
    ),
    path.match(
      /(\d{8,})/i
    ),
  ];

  for (
    const match of matches
  ) {
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function buildAlibabaCandidates(
  original: URL
) {
  const candidates: URL[] =
    [];

  const add = (
    value: URL
  ) => {
    if (
      !candidates.some(
        (row) =>
          row.toString() ===
          value.toString()
      )
    ) {
      candidates.push(
        value
      );
    }
  };

  add(
    new URL(
      original.toString()
    )
  );

  const clean =
    new URL(
      original.toString()
    );

  clean.search = "";
  clean.hash = "";

  add(clean);

  const productId =
    extractAlibabaProductId(
      original
    );

  if (productId) {
    add(
      new URL(
        `https://www.alibaba.com/product-detail/_${productId}.html`
      )
    );

    add(
      new URL(
        `https://www.alibaba.com/product-detail/ali_${productId}.html`
      )
    );
  }

  return candidates;
}

async function
fetchAlibabaPage(
  startUrl: URL
) {
  let current =
    startUrl;

  for (
    let redirects = 0;
    redirects < 5;
    redirects += 1
  ) {
    const response =
      await fetch(
        current.toString(),
        {
          redirect:
            "manual",

          cache:
            "no-store",

          headers: {
            Accept:
              "text/html,application/xhtml+xml",

            "Accept-Language":
              "en-US,en;q=0.9",

            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",

            Referer:
              "https://www.alibaba.com/",

            "Sec-Fetch-Dest":
              "document",

            "Sec-Fetch-Mode":
              "navigate",

            "Sec-Fetch-Site":
              "same-origin",
          },
        }
      );

    if (
      response.status >=
        300 &&
      response.status <
        400
    ) {
      const location =
        response.headers.get(
          "location"
        );

      if (!location) {
        throw Object.assign(
          new Error(
            "Alibaba redirect did not contain a destination."
          ),
          {
            status: 502,
          }
        );
      }

      const next =
        new URL(
          location,
          current
        );

      if (
        next.protocol !==
          "https:" ||
        !allowedAlibabaHost(
          next.hostname
        )
      ) {
        throw Object.assign(
          new Error(
            "Alibaba redirected outside the allowed product domain."
          ),
          {
            status: 502,
          }
        );
      }

      current =
        next;

      continue;
    }

    if (
      !response.ok
    ) {
      throw Object.assign(
        new Error(
          `Alibaba returned ${response.status}.`
        ),
        {
          status: 502,
        }
      );
    }

    const contentType =
      String(
        response.headers.get(
          "content-type"
        ) || ""
      ).toLowerCase();

    if (
      !contentType.includes(
        "text/html"
      )
    ) {
      throw Object.assign(
        new Error(
          "Alibaba did not return a product page."
        ),
        {
          status: 502,
        }
      );
    }

    const contentLength =
      Number(
        response.headers.get(
          "content-length"
        ) || 0
      );

    if (
      contentLength >
      MAX_HTML_BYTES
    ) {
      throw Object.assign(
        new Error(
          "Alibaba product page is too large to preview."
        ),
        {
          status: 502,
        }
      );
    }

    const html =
      (
        await response.text()
      ).slice(
        0,
        MAX_HTML_BYTES
      );

    return {
      html,

      finalUrl:
        current.toString(),
    };
  }

  throw Object.assign(
    new Error(
      "Too many Alibaba redirects."
    ),
    {
      status: 502,
    }
  );
}

export async function GET(
  req: NextRequest
) {
  const auth =
    await guardAuth(req);

  if (
    auth instanceof
      NextResponse
  ) {
    return auth;
  }

  try {
    const rawUrl =
      String(
        req.nextUrl
          .searchParams
          .get("url") ||
          ""
      ).trim();

    if (!rawUrl) {
      throw Object.assign(
        new Error(
          "Alibaba product link is required."
        ),
        {
          status: 400,
        }
      );
    }

    const productUrl =
      parseAlibabaUrl(
        rawUrl
      );

    const candidates =
      buildAlibabaCandidates(
        productUrl
      );

    let page:
      | {
          html: string;
          finalUrl: string;
        }
      | null =
        null;

    let lastError:
      any = null;

    for (
      const candidate
      of candidates
    ) {
      try {
        page =
          await fetchAlibabaPage(
            candidate
          );

        if (page) {
          break;
        }
      } catch (error: any) {
        lastError =
          error;
      }
    }

    if (!page) {
      throw (
        lastError ||
        Object.assign(
          new Error(
            "Alibaba product preview could not be loaded."
          ),
          {
            status: 502,
          }
        )
      );
    }

    const imageUrl =
      await pickValidatedProductImage(
        page.html,
        page.finalUrl
      );

    const details =
      extractAlibabaProductDetails(
        page.html
      );

    const images =
      collectAlibabaProductImages(
        page.html,
        page.finalUrl,
        imageUrl
      );

    const resolvedProductId =
      extractAlibabaProductId(
        new URL(
          page.finalUrl
        )
      ) ||
      extractAlibabaProductId(
        productUrl
      );

    return NextResponse.json(
      {
        ok: true,

        found:
          Boolean(
            imageUrl
          ),

        productUrl:
          page.finalUrl,

        title:
          pageTitle(
            page.html
          ),

        imageUrl,

        mainImage:
          imageUrl,

        images,

        productId:
          resolvedProductId,

        sku:
          details.sku,

        description:
          details.description,

        supplierName:
          details.supplierName,

        currency:
          details.currency,

        priceMin:
          details.priceMin,

        priceMax:
          details.priceMax,

        moq:
          details.moq,

        specifications:
          details.specifications,

        variants:
          details.variants,

        source:
          imageUrl
            ? "alibaba_page_metadata"
            : "not_found",
      },
      {
        headers: {
          "Cache-Control":
            "private, no-store, no-cache, must-revalidate",
        },
      }
    );
  } catch (error: any) {
    return fail(error);
  }
}
