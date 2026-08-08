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

export default defineConfig(({ command }) => ({
	base: command === "serve" ? "/" : configuredBasePath,
	build: {
		outDir: ".output/public",
		emptyOutDir: true,
	},
	plugins: [
		...solidStart(solidBase.startConfig({
			ssr: false,
		})),
		solidBase.plugin({
			title: ymlconfigs.title || "Github Action Solidbase Builder",
			description: ymlconfigs.description || "Solidbase Theme for markdown documents to site converter for GitHub Pages.",
			siteUrl: configuredSiteUrl,
			issueAutolink: ymlconfigs.issue_link || "https://github.com/nikescar/mdx-sitegen-solidbase/issues",
			editPath: ymlconfigs.edit_path || "https://github.com/nikescar/mdx-sitegen-solidbase/edit/main/:path",
			lang: ymlconfigs.lang || "en",
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
		OGPlugin() as any,
	],
}));
