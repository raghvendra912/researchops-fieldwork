"use client";

import { FormEvent, PointerEvent, useRef, useState } from "react";
import Image from "next/image";
import { apiRequest } from "../../src/lib/api";

type Project = {
  id: string;
  name: string;
  status: string;
  conversionRate?: number;
  starts?: number;
  completes?: number;
};
type Specification = {
  projectCode: string;
  liveSurveyUrl: string;
  testSurveyUrl: string;
};
type Message = { from: "user" | "assistant"; text: string };

export function ResearchOpsAssistant({ token }: { token?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      from: "assistant",
      text: "Hi! I can find low/high converting projects, missing or invalid survey links, setup gaps, and download a project CSV.",
    },
  ]);
  const [position, setPosition] = useState({ right: 24, bottom: 24 });
  const drag = useRef<{
    x: number;
    y: number;
    right: number;
    bottom: number;
  } | null>(null);
  const headers = token ? { authorization: `Bearer ${token}` } : undefined;

  async function portfolio() {
    const first = await apiRequest<{ data: Project[]; meta: { totalPages: number } }>(
      "/api/projects?scope=all&pageSize=100",
      { headers },
    );
    const projects = [...first.data];
    for (let page = 2; page <= first.meta.totalPages; page += 1) {
      const response = await apiRequest<{ data: Project[] }>(
        `/api/projects?scope=all&pageSize=100&page=${page}`,
        { headers },
      );
      projects.push(...response.data);
    }
    const specifications = projects.length
      ? (
          await apiRequest<{ data: Specification[] }>(
            `/api/projects/specifications?codes=${projects.map((item) => encodeURIComponent(item.id)).join(",")}`,
            { headers },
          )
        ).data
      : [];
    return {
      projects,
      specifications,
      specs: new Map(specifications.map((item) => [item.projectCode, item])),
    };
  }

  function downloadCsv(projects: Project[], specifications: Specification[]) {
    const specs = new Map(
      specifications.map((item) => [item.projectCode, item]),
    );
    const escape = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    const rows = [
      ["Project", "Name", "Status", "Conversion %", "Live URL", "Test URL"],
      ...projects.map((project) => [
        project.id,
        project.name,
        project.status,
        project.conversionRate ?? 0,
        specs.get(project.id)?.liveSurveyUrl ?? "",
        specs.get(project.id)?.testSurveyUrl ?? "",
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map((row) => row.map(escape).join(",")).join("\n")], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `researchops-project-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function answer(question: string) {
    setBusy(true);
    try {
      const { projects, specifications, specs } = await portfolio();
      const normalized = question.toLowerCase();
      let text = "";
      if (/csv|download|export/.test(normalized)) {
        downloadCsv(projects, specifications);
        text = `Downloaded a CSV audit for ${projects.length} projects.`;
      } else if (/missing|kya kami|gap|link nhi|link nahi/.test(normalized)) {
        const gaps = projects.filter(
          (project) => !specs.get(project.id)?.liveSurveyUrl,
        );
        text = gaps.length
          ? `Missing Live survey URL: ${gaps.map((item) => `${item.id} (${item.name})`).join(", ")}.`
          : "All listed projects have a Live survey URL.";
      } else if (/wrong|galat|invalid/.test(normalized)) {
        const invalid = specifications.filter((item) => {
          try {
            return (
              Boolean(item.liveSurveyUrl) &&
              !/^https?:$/.test(new URL(item.liveSurveyUrl).protocol)
            );
          } catch {
            return Boolean(item.liveSurveyUrl);
          }
        });
        text = invalid.length
          ? `Invalid Live URLs: ${invalid.map((item) => item.projectCode).join(", ")}.`
          : "No malformed Live survey URL found.";
      } else if (/low|kam convert/.test(normalized)) {
        const ranked = projects
          .filter((item) => (item.starts ?? 0) > 0)
          .sort((a, b) => (a.conversionRate ?? 0) - (b.conversionRate ?? 0))
          .slice(0, 5);
        text = ranked.length
          ? `Lowest conversion: ${ranked.map((item) => `${item.id} ${item.conversionRate ?? 0}%`).join(", ")}.`
          : "No projects have enough live starts to rank.";
      } else if (/high|jyada convert|best convert/.test(normalized)) {
        const ranked = projects
          .filter((item) => (item.starts ?? 0) > 0)
          .sort((a, b) => (b.conversionRate ?? 0) - (a.conversionRate ?? 0))
          .slice(0, 5);
        text = ranked.length
          ? `Highest conversion: ${ranked.map((item) => `${item.id} ${item.conversionRate ?? 0}%`).join(", ")}.`
          : "No projects have enough live starts to rank.";
      } else {
        const response = await apiRequest<{ data: { answer: string } }>(
          "/api/assistant",
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              question,
              projects: projects.slice(0, 500).map((project) => ({
                ...project,
                liveSurveyUrl: specs.get(project.id)?.liveSurveyUrl ?? "",
                testSurveyUrl: specs.get(project.id)?.testSurveyUrl ?? "",
              })),
            }),
          },
        );
        text = response.data.answer;
      }
      setMessages((current) => [...current, { from: "assistant", text }]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          from: "assistant",
          text: "Workspace analysis could not be loaded. Please retry.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    setMessages((current) => [...current, { from: "user", text: question }]);
    setInput("");
    void answer(question);
  }
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    drag.current = { x: event.clientX, y: event.clientY, ...position };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    setPosition({
      right: Math.max(8, drag.current.right - (event.clientX - drag.current.x)),
      bottom: Math.max(
        8,
        drag.current.bottom - (event.clientY - drag.current.y),
      ),
    });
  }

  return (
    <div
      className="ai-assistant"
      style={{ right: position.right, bottom: position.bottom }}
    >
      {open ? (
        <section className="ai-chat" aria-label="ResearchOps AI assistant">
          <div
            className="ai-chat-head"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={() => {
              drag.current = null;
            }}
          >
            <span>
              <Image src="/researchops-assistant.png" alt="" width={34} height={34} />
              ResearchOps Copilot
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
            >
              ×
            </button>
          </div>
          <div className="ai-messages">
            {messages.map((message, index) => (
              <div className={`ai-message ${message.from}`} key={index}>
                {message.text}
              </div>
            ))}
            {busy ? (
              <div className="ai-message assistant">Checking workspace…</div>
            ) : null}
          </div>
          <div className="ai-quick">
            <button
              type="button"
              onClick={() => void answer("low converting projects")}
            >
              Low conversion
            </button>
            <button type="button" onClick={() => void answer("missing links")}>
              Missing links
            </button>
            <button type="button" onClick={() => void answer("download csv")}>
              CSV
            </button>
          </div>
          <form onSubmit={submit}>
            <input
              aria-label="Ask ResearchOps Copilot"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about projects…"
            />
            <button type="submit" disabled={busy}>
              Send
            </button>
          </form>
        </section>
      ) : (
        <button
          className="ai-fab"
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open ResearchOps Copilot"
        >
          <Image src="/researchops-assistant.png" alt="ResearchOps Copilot" width={68} height={68} />
        </button>
      )}
    </div>
  );
}
