import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const mobile = (p: string) => fs.readFileSync(path.join(process.cwd(), "apps/mobile", p), "utf8");

test("Start new chat sheet keeps the active field and buttons above the keyboard", () => {
  const sheet = mobile("src/components/messages/StartNewChatSheet.tsx");
  assert.match(sheet, /<KeyboardAvoidingView\s+style=\{s\.keyboardAvoider\}\s+behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}/);
  assert.match(sheet, /<ScrollView\s+style=\{s\.kristoScroll\}\s+contentContainerStyle=\{s\.kristoPane\}\s+keyboardShouldPersistTaps="handled"/);
  assert.ok(sheet.indexOf("Look up member</Text>") > sheet.indexOf("<ScrollView"));
  assert.ok(sheet.indexOf("Start Chat</Text>") < sheet.indexOf("</ScrollView>"));
});
