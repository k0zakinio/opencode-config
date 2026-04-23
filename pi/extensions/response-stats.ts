/**
 * Response Stats Extension
 *
 * Shows per-turn timing stats in the footer status line:
 *   - Time to first token (TTFT)
 *   - Full response duration
 *   - Output tokens/s (computed over streaming interval only)
 *
 * Updates live during streaming and locks in final values on message end.
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const STATUS_KEY = "response-stats";

interface TurnTiming {
	startMs: number;
	firstTokenMs?: number;
	outputTokens: number;
	thinkTokens: number;
}

function splitTokens(message: AssistantMessage, totalOutput: number): { think: number; resp: number } {
	let thinkChars = 0;
	let respChars = 0;
	for (const c of message.content) {
		if (c.type === "thinking") thinkChars += c.thinking.length;
		else if (c.type === "text") respChars += c.text.length;
		else if (c.type === "toolCall") respChars += JSON.stringify(c.arguments ?? {}).length;
	}
	const totalChars = thinkChars + respChars;
	if (totalOutput > 0 && totalChars > 0) {
		const think = Math.round((totalOutput * thinkChars) / totalChars);
		return { think, resp: Math.max(0, totalOutput - think) };
	}
	return { think: Math.ceil(thinkChars / 4), resp: Math.ceil(respChars / 4) };
}

export default function (pi: ExtensionAPI) {
	let current: TurnTiming | undefined;
	let liveTimer: NodeJS.Timeout | undefined;

	const fmtMs = (ms: number): string =>
		ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;

	const stopLiveTimer = () => {
		if (liveTimer) {
			clearInterval(liveTimer);
			liveTimer = undefined;
		}
	};

	const format = (
		ttftMs: number | undefined,
		durationMs: number,
		thinkTokens: number,
		respTokens: number,
		tokensPerSec: number | undefined,
	): string => {
		const parts: string[] = ["⏱"];
		if (ttftMs !== undefined) parts.push(`TTFT ${fmtMs(ttftMs)}`);
		parts.push(fmtMs(durationMs));
		const total = thinkTokens + respTokens;
		if (total > 0) {
			if (thinkTokens > 0 && respTokens > 0) parts.push(`${thinkTokens} think + ${respTokens} out`);
			else if (thinkTokens > 0) parts.push(`${thinkTokens} think`);
			else parts.push(`${respTokens} out`);
		}
		if (tokensPerSec !== undefined) parts.push(`${tokensPerSec.toFixed(1)} tok/s`);
		return parts.join(" · ");
	};

	pi.on("before_provider_request", (_event, ctx) => {
		stopLiveTimer();
		current = { startMs: Date.now(), outputTokens: 0, thinkTokens: 0 };
		if (!ctx.hasUI) return;
		const theme = ctx.ui.theme;
		ctx.ui.setStatus(STATUS_KEY, theme.fg("dim", format(undefined, 0, 0, 0, undefined)));

		liveTimer = setInterval(() => {
			if (!current) return;
			const elapsed = Date.now() - current.startMs;
			const ttft = current.firstTokenMs !== undefined ? current.firstTokenMs - current.startMs : undefined;
			const respTokens = Math.max(0, current.outputTokens - current.thinkTokens);
			let tps: number | undefined;
			if (current.firstTokenMs !== undefined && current.outputTokens > 0) {
				const streamMs = Date.now() - current.firstTokenMs;
				if (streamMs > 0) tps = current.outputTokens / (streamMs / 1000);
			}
			ctx.ui.setStatus(
				STATUS_KEY,
				theme.fg("dim", format(ttft, elapsed, current.thinkTokens, respTokens, tps)),
			);
		}, 250);
	});

	pi.on("message_update", async (event, _ctx) => {
		if (event.message.role !== "assistant" || !current) return;

		const ev = event.assistantMessageEvent;
		if (
			current.firstTokenMs === undefined &&
			ev &&
			(ev.type === "text_delta" ||
				ev.type === "text_start" ||
				ev.type === "thinking_delta" ||
				ev.type === "thinking_start" ||
				ev.type === "toolcall_delta" ||
				ev.type === "toolcall_start")
		) {
			current.firstTokenMs = Date.now();
		}
		const usage = event.message.usage;
		const totalOut = usage && typeof usage.output === "number" ? usage.output : 0;
		const split = splitTokens(event.message, totalOut);
		current.thinkTokens = split.think;
		current.outputTokens = totalOut > 0 ? totalOut : split.think + split.resp;
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		const t = current;
		current = undefined;
		stopLiveTimer();
		if (!t) return;

		const endMs = Date.now();
		const durationMs = endMs - t.startMs;
		const ttftMs = t.firstTokenMs !== undefined ? t.firstTokenMs - t.startMs : undefined;
		const totalOut = event.message.usage?.output ?? t.outputTokens;
		const { think: thinkTokens, resp: respTokens } = splitTokens(event.message, totalOut);
		const outputTokens = thinkTokens + respTokens;

		let tokensPerSec: number | undefined;
		if (t.firstTokenMs !== undefined && outputTokens > 0) {
			const streamMs = endMs - t.firstTokenMs;
			if (streamMs > 0) tokensPerSec = outputTokens / (streamMs / 1000);
		}

		if (!ctx.hasUI) return;
		const theme = ctx.ui.theme;
		ctx.ui.setStatus(
			STATUS_KEY,
			theme.fg("dim", format(ttftMs, durationMs, thinkTokens, respTokens, tokensPerSec)),
		);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stopLiveTimer();
		current = undefined;
		if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
