import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(
    path.join(root, file),
    "utf8"
  );
}

const store = read(
  "app/api/_lib/store/sokoSellerAccessDb.ts"
);
const applicantRoute = read(
  "app/api/soko/seller/application/route.ts"
);
const accessRoute = read(
  "app/api/soko/seller/access/route.ts"
);
const adminRoute = read(
  "app/api/soko/system-admin/seller-applications/route.ts"
);
const moreScreen = read(
  "apps/mobile/app/(tabs)/more/index.tsx"
);
const adminDashboard = read(
  "apps/mobile/app/(tabs)/more/system-admin/report-center/index.tsx"
);
const applicantScreen = read(
  "apps/mobile/app/(tabs)/more/soko-seller/index.tsx"
);
const adminScreen = read(
  "apps/mobile/app/(tabs)/more/system-admin/report-center/soko-sellers/index.tsx"
);
const mobileApi = read(
  "apps/mobile/src/lib/sokoSellerAccessApi.ts"
);

test("seller application uses canonical Kristo identity", () => {
  assert.match(applicantRoute, /guardAuth\(req\)/);
  assert.match(applicantRoute, /getProfile\(/);
  assert.match(applicantRoute, /profile\?\.userCode/);
  assert.doesNotMatch(
    applicantRoute,
    /body\?\.(userId|kristoId)/
  );
});

test("V1 application has no Pastor approval dependency", () => {
  assert.doesNotMatch(
    store,
    /pastor_approval|pastor_user_id/i
  );
  assert.match(
    applicantScreen,
    /No Pastor permission is required/
  );
});

test("System Admin is the only approval authority", () => {
  assert.match(
    adminRoute,
    /guardPlatformOfflineActivation/
  );
  assert.match(adminRoute, /\["System_Admin"\]/);
  assert.match(adminScreen, /Approve & Issue Code/);
});

test("command code is one-time, expiring and identity-bound", () => {
  assert.match(store, /status = 'redeemed'/);
  assert.match(store, /code\.user_id = \$\{userId\}/);
  assert.match(store, /code\.kristo_id = \$\{kristoId\}/);
  assert.match(store, /code\.status = 'active'/);
  assert.match(store, /code\.expires_at > NOW\(\)/);
  assert.match(store, /INTERVAL '7 days'/);
  assert.match(store, /WITH claimed AS/);
});

test("seller access is durable backend state", () => {
  assert.match(store, /soko_seller_accounts/);
  assert.match(accessRoute, /dbGetSokoSellerAccess/);
  assert.match(accessRoute, /dbRedeemSokoSellerCommandCode/);
  assert.match(mobileApi, /\/api\/soko\/seller\/application/);
  assert.doesNotMatch(
    applicantScreen,
    /@soko\/seller-approved-v1/
  );
});

test("Kristo navigation exposes applicant and admin workspaces", () => {
  assert.match(moreScreen, /key: "soko_seller"/);
  assert.match(moreScreen, /href: "\/more\/soko-seller"/);
  assert.match(
    adminDashboard,
    /\/more\/system-admin\/report-center\/soko-sellers/
  );
});

test("prototype code is removed from production source", () => {
  assert.doesNotMatch(store, /SOKO-PF-001/);
  assert.doesNotMatch(accessRoute, /SOKO-PF-001/);
  assert.doesNotMatch(applicantScreen, /SOKO-PF-001/);
});
