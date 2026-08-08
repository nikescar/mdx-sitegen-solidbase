import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "yaml";
import { defineConfig } from "vite";
import { solidStart } from "@solidjs/start/config";
import { createSolidBase } from "@kobalte/solidbase/config";
import defaultTheme from "@kobalte/solidbase/default-theme";
import { vitePlugin as OGPlugin } from "@solid-mediakit/og/unplugin";

type RouteMetadata = {
	title: string,
	description?: string,
	order?: number,
}

type Route = {
	slug: string,
	metadata: RouteMetadata,
}

const createStaticShellPlugin = (basePath: string, title: string, description: string, lang: string) => {
	const withBase = (assetPath: string) => {
		const normalizedBase = basePath === "/" ? "" : basePath.replace(/\/$/, "");
		return `${normalizedBase}/${assetPath.replace(/^\//, "")}`;
	}

	return {
		name: "solidbase-static-shell",
		apply: "build" as const,
		closeBundle() {
			const cwd = process.cwd();
			const clientDir = path.join(cwd, "dist/client");
			const publicDir = path.join(cwd, ".output/public");
			const manifestPath = path.join(clientDir, ".vite/manifest.json");

			if (!fs.existsSync(manifestPath)) {
				return;
			}

			const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
			const entry = manifest["src/entry-client.tsx"];

			if (!entry?.file) {
				throw new Error("Unable to locate the client entry in dist/client/.vite/manifest.json.");
			}

			const cssLinks = (entry.css ?? [])
				.map((cssFile: string) => `    <link rel="stylesheet" href="${withBase(cssFile)}" />`)
				.join("\n");

			const html = [
				"<!doctype html>",
				`<html lang="${lang}">`,
				"  <head>",
				'    <meta charset="utf-8" />',
				'    <meta name="viewport" content="width=device-width, initial-scale=1" />',
				`    <title>${title}</title>`,
				`    <meta name="description" content="${description}" />`,
				'    <link rel="icon" href="favicon.ico" />',
				cssLinks,
				"  </head>",
				"  <body>",
				'    <div id="app"></div>',
				`    <script type="module" src="${withBase(entry.file)}"></script>`,
				"  </body>",
				"</html>",
				"",
			].filter(Boolean).join("\n");

			const redirectBase = basePath.endsWith("/") ? basePath : `${basePath}/`;
			const notFoundHtml = [
				"<!doctype html>",
				"<html>",
				"  <body>",
				"    <script>",
				`      const base = ${JSON.stringify(redirectBase)};`,
				"      const params = new URLSearchParams({ _g: `${window.location.pathname}${window.location.search}${window.location.hash}` });",
				"      window.location.replace(`${base}?${params.toString()}`);",
				"    </script>",
				"  </body>",
				"</html>",
				"",
			].join("\n");

			fs.writeFileSync(path.join(clientDir, "index.html"), html);
			fs.writeFileSync(path.join(clientDir, "404.html"), notFoundHtml);

			fs.rmSync(publicDir, { recursive: true, force: true });
			fs.mkdirSync(publicDir, { recursive: true });
			fs.cpSync(clientDir, publicDir, { recursive: true });
		},
	};
}

const parseMetadata = (filePath: string): RouteMetadata => {
	const contents = fs.readFileSync(filePath, "utf8");
	const start = contents.indexOf("---");
	const end = contents.lastIndexOf("---");
	const fallbackTitle = path.basename(filePath, path.extname(filePath));

	if (start === -1 || end === -1 || end <= start) {
		return { title: fallbackTitle };
	}

	const yaml = contents.substring(start + 3, end);
	const parsed = parse(yaml) ?? {};

	return {
		...parsed,
		title: parsed.title ?? fallbackTitle,
	};
}

const getRoutes = (base: string, paths: string[]): Route[] => {
	return paths
		.filter((filePath) => filePath.endsWith(".mdx"))
		.map((filePath) => ({
			slug: filePath
				.replace(path.normalize(base), "")
				.replaceAll("\\", "/")
				.replace(".mdx", ""),
			metadata: parseMetadata(filePath),
		}));
}

const getPathsSync = (base: string): string[] => {
	const paths: string[] = [];

	const readDirRecursive = (dir: string) => {
		try {
			const files = fs.readdirSync(dir, { withFileTypes: true });

			for (const file of files) {
				const fullPath = path.join(dir, file.name);

				if (file.isDirectory()) {
					readDirRecursive(fullPath);
				} else {
					paths.push(fullPath);
				}
			}
		} catch {
			// Directory doesn't exist or no permissions.
		}
	};

	readDirRecursive(base);
	return paths;
}

const routes = getRoutes("src/routes", getPathsSync("src/routes")).filter((route) => route.slug !== "/index");

const ymlconfigs: Record<string, any> = {};
const configPath = path.join(process.cwd(), "_config.yml");

if (fs.existsSync(configPath)) {
	const configContent = fs.readFileSync(configPath, "utf8");

	try {
		const config = parse(configContent) ?? {};

		for (const key of Object.keys(config)) {
			ymlconfigs[key] = config[key];
		}
	} catch (error) {
		console.error("Failed to parse _config.yml:", error);
	}
} else {
	console.warn("_config.yml not found, using default configuration.");
}

const configuredSiteUrl = ymlconfigs.site_url || "https://example.com/";
const configuredBasePath = new URL(configuredSiteUrl).pathname.replace(/\/$/, "") || "/";
const solidBase = createSolidBase(defaultTheme);
const resolvedTitle = ymlconfigs.title || "Github Action Solidbase Builder";
const resolvedDescription = ymlconfigs.description || "Solidbase Theme for markdown documents to site converter for GitHub Pages.";
const resolvedLang = ymlconfigs.lang || "en";

export default defineConfig(({ command }) => ({
	base: command === "serve" ? "/" : configuredBasePath,
	plugins: [
		solidBase.plugin({
			title: resolvedTitle,
			description: resolvedDescription,
			siteUrl: configuredSiteUrl,
			issueAutolink: ymlconfigs.issue_link || "https://github.com/nikescar/mdx-sitegen-solidbase/issues",
			editPath: ymlconfigs.edit_path || "https://github.com/nikescar/mdx-sitegen-solidbase/edit/main/:path",
			lang: resolvedLang,
			locales: ymlconfigs.locales || {},
			themeConfig: {
				socialLinks: {
					...Object.entries(ymlconfigs.theme_config?.social_links || {}).reduce((acc, [key, value]) => {
						acc[key] = { link: value as string };
						return acc;
					}, {} as Record<string, { link: string }>),
				},
				nav: [
					...Object.entries(ymlconfigs.theme_config?.nav || {}).map(([text, link]) => ({
						text,
						link: link as string,
					})),
				],
				sidebar: {
					...(ymlconfigs.theme_config?.sidebar?.reduce((acc: any, sidebarItem: any) => {
						const [title, sections] = Object.entries(sidebarItem)[0] as [string, any];
						const sidebarSlug = `/${title.toLowerCase()}`;

						let items: any[] = [];

						if (Array.isArray(sections)) {
							sections.forEach((section: any) => {
								const [sectionTitle, sectionItems] = Object.entries(section)[0] as [string, any];

								if (typeof sectionItems === "object" && sectionItems !== null) {
									items.push({
										title: sectionTitle,
										items: Object.entries(sectionItems).map(([itemTitle, itemSlug]) => ({
											title: itemTitle,
											link: itemSlug as string,
										})),
									});
								}
							});
						} else if (typeof sections === "object" && sections !== null) {
							Object.entries(sections).forEach(([sectionTitle, sectionItems]) => {
								if (typeof sectionItems === "object" && sectionItems !== null) {
									items.push({
										title: sectionTitle,
										items: Object.entries(sectionItems).map(([itemTitle, itemSlug]) => ({
											title: itemTitle,
											link: itemSlug as string,
										})),
									});
								}
							});
						} else {
							items = routes
								.filter((route) => route.slug.startsWith(sidebarSlug))
								.map((route) => ({
									title: route.metadata.title,
									link: route.slug,
								}));
						}

						acc[sidebarSlug] = items;
						return acc;
					}, {}) || {}),
				},
			},
		}),
		...solidStart(solidBase.startConfig({
			ssr: false,
		})),
		OGPlugin() as any,
		createStaticShellPlugin(configuredBasePath, resolvedTitle, resolvedDescription, resolvedLang),
	],
}));
