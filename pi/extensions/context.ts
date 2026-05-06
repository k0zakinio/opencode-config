/**
 * /context
 *
 * Persistent context bar in the footer showing:
 * - context window usage bar (sys / tools / convo / free)
 * - session token breakdown (input / output / cacheRead / cacheWrite)
 * - loaded skills
 *
 * Toggle with /context.
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ToolResultEvent } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, type Component } from "@mariozechner/pi-tui";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";

// ── Helpers ──────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
	return Math.max(0, Math.ceil(text.length / 4));
}

function normalizeReadPath(inputPath: string, cwd: string): string {
	let p = inputPath;
	if (p.startsWith("@")) p = p.slice(1);
	if (p === "~") p = os.homedir();
	else if (p.startsWith("~/")) p = path.join(os.homedir(), p.slice(2));
	if (!path.isAbsolute(p)) p = path.resolve(cwd, p);
	return path.resolve(p);
}

function getAgentDir(): string {
	const envCandidates = ["PI_CODING_AGENT_DIR", "TAU_CODING_AGENT_DIR"];
	let envDir: string | undefined;
	for (const k of envCandidates) {
		if (process.env[k]) { envDir = process.env[k]; break; }
	}
	if (!envDir) {
		for (const [k, v] of Object.entries(process.env)) {
			if (k.endsWith("_CODING_AGENT_DIR") && v) { envDir = v; break; }
		}
	}
	if (envDir) {
		if (envDir === "~") return os.homedir();
		if (envDir.startsWith("~/")) return path.join(os.homedir(), envDir.slice(2));
		return envDir;
	}
	return path.join(os.homedir(), ".pi", "agent");
}

async function readFileIfExists(filePath: string): Promise<{ path: string; content: string; bytes: number } | null> {
	if (!existsSync(filePath)) return null;
	try {
		const buf = await fs.readFile(filePath);
		return { path: filePath, content: buf.toString("utf8"), bytes: buf.byteLength };
	} catch {
		return null;
	}
}

async function loadProjectContextFiles(cwd: string): Promise<Array<{ path: string; tokens: number; bytes: number }>> {
	const out: Array<{ path: string; tokens: number; bytes: number }> = [];
	const seen = new Set<string>();

	const loadFromDir = async (dir: string) => {
		for (const name of ["AGENTS.md", "CLAUDE.md"]) {
			const p = path.join(dir, name);
			const f = await readFileIfExists(p);
			if (f && !seen.has(f.path)) {
				seen.add(f.path);
				out.push({ path: f.path, tokens: estimateTokens(f.content), bytes: f.bytes });
				return;
			}
		}
	};

	await loadFromDir(getAgentDir());
	const stack: string[] = [];
	let current = path.resolve(cwd);
	while (true) {
		stack.push(current);
		const parent = path.resolve(current, "..");
		if (parent === current) break;
		current = parent;
	}
	stack.reverse();
	for (const dir of stack) await loadFromDir(dir);
	return out;
}

function normalizeSkillName(name: string): string {
	return name.startsWith("skill:") ? name.slice("skill:".length) : name;
}

type SkillIndexEntry = { name: string; skillFilePath: string; skillDir: string };

function buildSkillIndex(pi: ExtensionAPI, cwd: string): SkillIndexEntry[] {
	return pi
		.getCommands()
		.filter((c) => c.source === "skill")
		.map((c) => {
			const p = c.path ? normalizeReadPath(c.path, cwd) : "";
			return { name: normalizeSkillName(c.name), skillFilePath: p, skillDir: p ? path.dirname(p) : "" };
		})
		.filter((x) => x.name && x.skillDir);
}

const SKILL_LOADED_ENTRY = "context:skill_loaded";
type SkillLoadedEntryData = { name: string; path: string };

function getLoadedSkillsFromSession(ctx: ExtensionContext): Set<string> {
	const out = new Set<string>();
	for (const e of ctx.sessionManager.getEntries()) {
		if ((e as any)?.type !== "custom") continue;
		if ((e as any)?.customType !== SKILL_LOADED_ENTRY) continue;
		const data = (e as any)?.data as SkillLoadedEntryData | undefined;
		if (data?.name) out.add(data.name);
	}
	return out;
}

function sumSessionUsage(ctx: ExtensionCommandContext) {
	let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
	for (const e of ctx.sessionManager.getBranch()) {
		if (e.type === "message" && e.message.role === "assistant") {
			const u = (e.message as any).usage;
			if (u) {
				input += u.input ?? 0;
				output += u.output ?? 0;
				cacheRead += u.cacheRead ?? 0;
				cacheWrite += u.cacheWrite ?? 0;
			}
		}
	}
	return { input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite };
}

function shortenPath(p: string, cwd: string): string {
	const rp = path.resolve(p);
	const rc = path.resolve(cwd);
	if (rp === rc) return ".";
	if (rp.startsWith(rc + path.sep)) return "./" + rp.slice(rc.length + 1);
	return rp;
}

// ── Usage bar rendering ──────────────────────────────────────────────

function renderUsageBar(theme: any, parts: { system: number; tools: number; convo: number; remaining: number }, total: number, width: number): string {
	const w = Math.max(10, width);
	if (total <= 0) return "";
	// Divide the bar into 10 slots (each ~10% of the context window).
	// Each slot is a block of █ chars separated by a space.
	const slots = 10;
	const slotWidth = Math.max(1, Math.floor(w / slots)); // chars per slot (excluding gap)
	const slotThreshold = total / slots; // tokens per 10% slot

	let result = "";
	const used = parts.system + parts.tools + parts.convo;
	for (let i = 0; i < slots; i++) {
		const slotStart = i * slotThreshold;
		const slotEnd = (i + 1) * slotThreshold;

		// Determine which segment this slot falls into
		let color: string;
		if (slotStart < parts.system) {
			color = "accent";
		} else if (slotStart < parts.system + parts.tools) {
			color = "warning";
		} else if (slotStart < parts.system + parts.tools + parts.convo) {
			color = "success";
		} else {
			color = "dim";
		}

		// Calculate how much of this slot is filled
		const filledEnd = Math.min(slotEnd, used);
		const filledAmount = Math.max(0, filledEnd - slotStart);
		const fillRatio = filledAmount / slotThreshold;

		// Only fill if the slot is more than half full, otherwise leave empty
		const filledChars = fillRatio > 0.5 ? slotWidth : 0;

		if (i > 0) result += theme.fg(color, " ");
		result += theme.fg(color, "█".repeat(filledChars)) + theme.fg("dim", "░".repeat(slotWidth - filledChars));
	}
	return result;
}

// ── Footer component ─────────────────────────────────────────────────

type ContextBarData = {
	usage: {
		messageTokens: number;
		contextWindow: number;
		effectiveTokens: number;
		percent: number;
		remainingTokens: number;
		systemPromptTokens: number;
		agentTokens: number;
		toolsTokens: number;
		activeTools: number;
	} | null;
	agentFiles: string[];
	extensions: string[];
	skills: string[];
	loadedSkills: string[];
	session: { totalTokens: number; input: number; output: number; cacheRead: number; cacheWrite: number };
};

class ContextBar implements Component {
	private theme: any;
	private data: ContextBarData;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(theme: any, data: ContextBarData) {
		this.theme = theme;
		this.data = data;
	}

	private buildLine(width: number): string {
		const dim = (s: string) => this.theme.fg("dim", s);
		const text = (s: string) => this.theme.fg("text", s);

		const parts: string[] = [];

		// Usage bar + tokens
		if (this.data.usage) {
			const u = this.data.usage;
			const barWidth = Math.max(10, Math.min(30, width - 60));
			const sysInMessages = Math.min(u.systemPromptTokens, u.messageTokens);
			const convoInMessages = Math.max(0, u.messageTokens - sysInMessages);
			const bar = renderUsageBar(this.theme, { system: sysInMessages, tools: u.toolsTokens, convo: convoInMessages, remaining: u.remainingTokens }, u.contextWindow, barWidth);
			parts.push(bar + dim(` ${u.effectiveTokens.toLocaleString()}/${u.contextWindow.toLocaleString()}`));
		} else {
			parts.push(dim("(unknown)"));
		}

		// Session token breakdown
		const fmt = (n: number) => (n < 10000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);
		const stats: string[] = [text(`↓${fmt(this.data.session.input)}`), text(`↑${fmt(this.data.session.output)}`)];
		if (this.data.session.cacheRead > 0) stats.push(text(`cr:${fmt(this.data.session.cacheRead)}`));
		if (this.data.session.cacheWrite > 0) stats.push(text(`cw:${fmt(this.data.session.cacheWrite)}`));
		parts.push(dim(" · ") + stats.join(dim(" ")));

		// Skills (loaded highlighted)
		if (this.data.skills.length > 0) {
			const loaded = new Set(this.data.loadedSkills);
			const skillStr = this.data.skills.map((s) => loaded.has(s) ? this.theme.fg("success", s) : dim(s)).join(", ");
			parts.push(dim(" · skills: ") + skillStr);
		}

		return truncateToWidth(parts.join(""), width);
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		this.cachedLines = [this.buildLine(width)];
		this.cachedWidth = width;
		return this.cachedLines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

// ── Extension entry point ────────────────────────────────────────────

export default function contextExtension(pi: ExtensionAPI) {
	let lastSessionId: string | null = null;
	let cachedLoadedSkills = new Set<string>();
	let cachedSkillIndex: SkillIndexEntry[] = [];
	let footerActive = true;
	let currentCtx: ExtensionCommandContext | null = null;

	// Auto-enable on startup
	pi.on("agent_start", async (_event, ctx: ExtensionContext) => {
		if (footerActive) {
			updateFooter(ctx as ExtensionCommandContext);
		}
	});

	const ensureCaches = (ctx: ExtensionContext) => {
		const sid = ctx.sessionManager.getSessionId();
		if (sid !== lastSessionId) {
			lastSessionId = sid;
			cachedLoadedSkills = getLoadedSkillsFromSession(ctx);
			cachedSkillIndex = buildSkillIndex(pi, ctx.cwd);
		}
		if (cachedSkillIndex.length === 0) {
			cachedSkillIndex = buildSkillIndex(pi, ctx.cwd);
		}
	};

	const matchSkillForPath = (absPath: string): string | null => {
		let best: SkillIndexEntry | null = null;
		for (const s of cachedSkillIndex) {
			if (!s.skillDir) continue;
			if (absPath === s.skillFilePath || absPath.startsWith(s.skillDir + path.sep)) {
				if (!best || s.skillDir.length > best.skillDir.length) best = s;
			}
		}
		return best?.name ?? null;
	};

	// Track skill loads via read tool
	pi.on("tool_result", (event: ToolResultEvent, ctx: ExtensionContext) => {
		if ((event as any).toolName !== "read") return;
		if ((event as any).isError) return;
		const input = (event as any).input as { path?: unknown } | undefined;
		const p = typeof input?.path === "string" ? input.path : "";
		if (!p) return;
		ensureCaches(ctx);
		const abs = normalizeReadPath(p, ctx.cwd);
		const skillName = matchSkillForPath(abs);
		if (!skillName) return;
		if (!cachedLoadedSkills.has(skillName)) {
			cachedLoadedSkills.add(skillName);
			pi.appendEntry<SkillLoadedEntryData>(SKILL_LOADED_ENTRY, { name: skillName, path: abs });
			if (footerActive && currentCtx) {
				updateFooter(currentCtx);
			}
		}
	});

	// Re-render on turn boundaries (usage changes)
	pi.on("turn_end", async (_event, ctx: ExtensionContext) => {
		if (footerActive) {
			updateFooter(ctx as ExtensionCommandContext);
		}
	});

	function updateFooter(ctx: ExtensionCommandContext) {
		if (!footerActive) return;
		currentCtx = ctx;

		const commands = pi.getCommands();
		const extensionCmds = commands.filter((c) => c.source === "extension");
		const skillCmds = commands.filter((c) => c.source === "skill");

		const extensionsByPath = new Map<string, string[]>();
		for (const c of extensionCmds) {
			const p = c.path ?? "<unknown>";
			const arr = extensionsByPath.get(p) ?? [];
			arr.push(c.name);
			extensionsByPath.set(p, arr);
		}
		const extensionFiles = [...extensionsByPath.keys()]
			.map((p) => (p === "<unknown>" ? p : path.basename(p)))
			.sort((a, b) => a.localeCompare(b));

		const skills = skillCmds.map((c) => normalizeSkillName(c.name)).sort((a, b) => a.localeCompare(b));

		const agentFiles = loadProjectContextFiles(ctx.cwd);
		const agentTokensPromise = agentFiles.then((files) => files.reduce((a, f) => a + f.tokens, 0));
		const agentFilePathsPromise = agentFiles.then((files) => files.map((f) => shortenPath(f.path, ctx.cwd)));

		const systemPrompt = ctx.getSystemPrompt();
		const systemPromptTokens = systemPrompt ? estimateTokens(systemPrompt) : 0;

		const usage = ctx.getContextUsage();
		const messageTokens = usage?.tokens ?? 0;
		const ctxWindow = usage?.contextWindow ?? 0;

		const TOOL_FUDGE = 1.5;
		const activeToolNames = pi.getActiveTools();
		const toolInfoByName = new Map(pi.getAllTools().map((t) => [t.name, t] as const));
		let toolsTokens = 0;
		for (const name of activeToolNames) {
			const info = toolInfoByName.get(name);
			const blob = `${name}\n${info?.description ?? ""}`;
			toolsTokens += estimateTokens(blob);
		}
		toolsTokens = Math.round(toolsTokens * TOOL_FUDGE);

		const effectiveTokens = messageTokens + toolsTokens;
		const percent = ctxWindow > 0 ? (effectiveTokens / ctxWindow) * 100 : 0;
		const remainingTokens = ctxWindow > 0 ? Math.max(0, ctxWindow - effectiveTokens) : 0;

		const sessionUsage = sumSessionUsage(ctx);
		const loadedSkills = Array.from(getLoadedSkillsFromSession(ctx)).sort((a, b) => a.localeCompare(b));

		Promise.all([agentTokensPromise, agentFilePathsPromise]).then(([agentTokens, agentFilePaths]) => {
			const viewData: ContextBarData = {
				usage: usage ? { messageTokens, contextWindow: ctxWindow, effectiveTokens, percent, remainingTokens, systemPromptTokens, agentTokens, toolsTokens, activeTools: activeToolNames.length } : null,
				agentFiles: agentFilePaths,
				extensions: extensionFiles,
				skills,
				loadedSkills,
				session: { totalTokens: sessionUsage.totalTokens, input: sessionUsage.input, output: sessionUsage.output, cacheRead: sessionUsage.cacheRead, cacheWrite: sessionUsage.cacheWrite },
			};

			const bar = new ContextBar(ctx.ui.theme, viewData);
			ctx.ui.setFooter((tui, theme, footerData) => {
				bar.theme = theme;
				return {
					render: (w: number) => bar.render(w),
					invalidate: () => bar.invalidate(),
					dispose: footerData.onBranchChange(() => tui.requestRender()),
				};
			});
		});
	}

	pi.registerCommand("context", {
		description: "Toggle persistent context bar in footer",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			footerActive = !footerActive;

			if (footerActive) {
				currentCtx = ctx;
				updateFooter(ctx);
				ctx.ui.notify("Context bar enabled", "info");
			} else {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Context bar disabled", "info");
			}
		},
	});
}
