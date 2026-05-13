import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const themes = [
  {
    input: process.env.XCODE_LIGHT_THEME || locateCurrentXcodeTheme(),
    output: fileURLToPath(new URL("../src/themes/xcode-light.json", import.meta.url)),
  },
  {
    input: process.env.XCODE_DARK_THEME || "Framer-based 5.xccolortheme",
    output: fileURLToPath(new URL("../src/themes/xcode-dark.json", import.meta.url)),
  },
];

for (const { input, output } of themes) {
  const themePath = resolveTheme(input);
  const theme = createTheme(themePath);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(theme, null, 2)}\n`);
  console.log(`Generated ${output} from ${themePath}`);
}

function locateCurrentXcodeTheme() {
  const themeName = execFileSync("defaults", ["read", "com.apple.dt.Xcode", "XCFontAndColorCurrentTheme"], {
    encoding: "utf8",
  }).trim();

  return themeName;
}

function resolveTheme(input) {
  if (existsSync(input)) {
    return input;
  }

  const themeName = input.endsWith(".xccolortheme") ? input : `${input}.xccolortheme`;
  const directMatch = themeSearchDirectories()
    .map((directory) => join(directory, themeName))
    .find((path) => existsSync(path));

  if (directMatch) {
    return directMatch;
  }

  const spotlightMatches = execFileSync("mdfind", [`kMDItemFSName == ${JSON.stringify(themeName)}`], {
    encoding: "utf8",
  })
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean);

  const spotlightMatch = spotlightMatches.find((path) => existsSync(path));
  if (spotlightMatch) {
    return spotlightMatch;
  }

  throw new Error(`Could not locate Xcode theme: ${themeName}`);
}

function createTheme(themePath) {
  const themeName = basename(themePath, ".xccolortheme");
  const plist = JSON.parse(
    execFileSync("plutil", ["-convert", "json", "-o", "-", themePath], { encoding: "utf8" }),
  );
  const syntax = plist.DVTSourceTextSyntaxColors ?? {};
  const background = color(plist.DVTSourceTextBackground) ?? "#ffffff";
  const foreground = color(syntax["xcode.syntax.plain"]) ?? "#24292e";
  const selection = color(plist.DVTSourceTextSelectionColor) ?? "#0969da22";
  const currentLine = color(plist.DVTSourceTextCurrentLineHighlightColor) ?? "#0969da11";
  const token = tokenFor(syntax);

  return {
    name: `xcode-${slugify(themeName)}`,
    type: luminance(background) < 0.5 ? "dark" : "light",
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editor.lineHighlightBackground": currentLine,
      "editor.selectionBackground": selection,
      "editorCursor.foreground": color(plist.DVTSourceTextInsertionPointColor) ?? foreground,
      "editorWhitespace.foreground": color(plist.DVTSourceTextInvisiblesColor) ?? "#6e778166",
    },
    tokenColors: [
      token(["source"], "xcode.syntax.plain"),
      token(["comment", "punctuation.definition.comment"], "xcode.syntax.comment", { fontStyle: "italic" }),
      token(["comment.block.documentation", "comment.line.documentation"], "xcode.syntax.comment.doc", {
        fontStyle: "italic",
      }),
      token(["keyword", "storage", "storage.type", "storage.modifier"], "xcode.syntax.keyword"),
      token(["keyword.control.import", "meta.preprocessor", "entity.name.function.preprocessor"], "xcode.syntax.preprocessor"),
      token(["string", "punctuation.definition.string"], "xcode.syntax.string"),
      token(["constant.character", "string.quoted.single"], "xcode.syntax.character"),
      token(["constant.numeric", "constant.language.boolean"], "xcode.syntax.number"),
      token(["string.regexp"], "xcode.syntax.regex"),
      token(["entity.name.function", "support.function", "variable.function"], "xcode.syntax.identifier.function"),
      token(["entity.name.function.macro"], "xcode.syntax.identifier.macro"),
      token(
        ["entity.name.type", "entity.name.class", "entity.name.struct", "entity.name.enum", "support.type", "support.class"],
        "xcode.syntax.identifier.type",
      ),
      token(["entity.name.tag", "entity.other.attribute-name"], "xcode.syntax.declaration.other"),
      token(["variable", "variable.other", "variable.parameter"], "xcode.syntax.identifier.variable"),
      token(["constant.other", "variable.other.constant", "support.constant"], "xcode.syntax.identifier.constant"),
      token(["meta.attribute", "support.attribute"], "xcode.syntax.attribute"),
      token(["markup.raw", "markup.inline.raw"], "xcode.syntax.markup.code"),
      token(["markup.underline.link"], "xcode.syntax.url"),
    ].filter(Boolean),
    metadata: {
      source: "Xcode Font and Color Theme",
      sourceTheme: themeName,
      sourceFile: basename(themePath),
    },
  };
}

function themeSearchDirectories() {
  return [
    join(homedir(), "Library/Developer/Xcode/UserData/FontAndColorThemes"),
    join(homedir(), "muuk-env/xcode/FontAndColorThemes"),
  ];
}

function tokenFor(syntax) {
  return (scope, key, extras = {}) => {
    const foreground = color(syntax[key]);
    return foreground ? { scope, settings: { foreground, ...extras } } : undefined;
  };
}

function color(value) {
  if (typeof value !== "string") {
    return undefined;
  }

  const [red, green, blue, alpha = 1] = value.split(/\s+/).map(Number);
  if ([red, green, blue, alpha].some((component) => Number.isNaN(component))) {
    return undefined;
  }

  const channels = [red, green, blue].map((component) =>
    Math.max(0, Math.min(255, Math.round(component * 255)))
      .toString(16)
      .padStart(2, "0"),
  );

  if (alpha < 1) {
    channels.push(
      Math.max(0, Math.min(255, Math.round(alpha * 255)))
        .toString(16)
        .padStart(2, "0"),
    );
  }

  return `#${channels.join("")}`;
}

function luminance(hex) {
  const [red, green, blue] = hex
    .replace("#", "")
    .slice(0, 6)
    .match(/.{2}/g)
    .map((channel) => parseInt(channel, 16) / 255)
    .map((component) =>
      component <= 0.03928 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4,
    );

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
