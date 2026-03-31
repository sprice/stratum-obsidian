import * as jsonModule from "@eslint/json";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import { PlainTextParser } from "eslint-plugin-obsidianmd/dist/lib/plainTextParser.js";
import globals from "globals";
import { globalIgnores } from "eslint/config";

const json = "default" in jsonModule ? jsonModule.default : jsonModule;

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.mts", "manifest.json"],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: [".json"],
			},
		},
	},
	...obsidianmd.configs.recommendedWithLocalesEn,
	{
		files: ["manifest.json"],
		plugins: {
			json,
			obsidianmd,
		},
		language: "json/json",
		rules: {
			"no-irregular-whitespace": "off",
			"obsidianmd/validate-manifest": "error",
		},
	},
	{
		files: ["LICENSE"],
		plugins: {
			obsidianmd,
		},
		languageOptions: {
			parser: PlainTextParser,
		},
		rules: {
			"no-irregular-whitespace": "off",
			"obsidianmd/validate-license": "error",
		},
	},
	...(process.env.OBSIDIAN_REVIEW === "1"
		? [
				{
					files: ["src/**/*.ts", "src/**/*.tsx"],
					rules: {
						"@typescript-eslint/require-await": "error",
					},
				},
			]
		: []),
	{
		files: ["src/test/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			"@typescript-eslint/no-floating-promises": "off",
			"import/no-nodejs-modules": "off",
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.mts",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);
