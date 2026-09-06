import { useCallback, type Dispatch, type SetStateAction } from "react";
import * as api from "@/lib/api";
import type { MessageKey, Vars } from "@/i18n";
import { buildPrReviewPrompt, parsePullRequestRef } from "@/lib/ghReview";
import type { SessionActionDialog } from "./useSessionActions";

type T = (key: MessageKey, vars?: Vars) => string;

export type PrActionModel = { id: string; label?: string };

export type PrActionsDeps = {
  activeProjectPath?: string | null;
  reviewModelId: string | null;
  reviewRoleModelId?: string | null;
  availableModels: PrActionModel[];
  runBatch: (tasks: Array<{ title: string; prompt: string; modelId: string }>) => Promise<void>;
  openDialog: (dialog: SessionActionDialog) => void;
  startReviewChat: (seedDraft: string) => Promise<void>;
  setComparisonOpen: Dispatch<SetStateAction<boolean>>;
  showToast: (message: string, durationMs?: number) => void;
  tr: T;
};

/** PR review/comment actions shared by the PR workspace and slash commands. */
export function usePrActions({
  activeProjectPath,
  reviewModelId,
  reviewRoleModelId,
  availableModels,
  runBatch,
  openDialog,
  startReviewChat,
  setComparisonOpen,
  showToast,
  tr,
}: PrActionsDeps) {
  const openReviewPrDialog = useCallback(() => {
    const projectPath = activeProjectPath?.trim();
    if (!projectPath) {
      showToast(tr("reviewPr.noProject"));
      return;
    }
    openDialog({
      kind: "prompt",
      title: tr("reviewPr.title"),
      message: tr("reviewPr.message"),
      initial: "",
      placeholder: tr("reviewPr.placeholder"),
      submitLabel: tr("reviewPr.submit"),
      onSubmit: async (raw) => {
        const ref = parsePullRequestRef(raw);
        if (!ref) {
          showToast(tr("reviewPr.badRef"));
          return;
        }
        const gh = await api.ghAvailable(projectPath);
        if (!gh.installed) {
          showToast(tr("reviewPr.ghMissing"), 6000);
          return;
        }
        if (!gh.authenticated) {
          showToast(tr("reviewPr.ghUnauthenticated"), 6000);
          return;
        }
        showToast(tr("reviewPr.loading", { number: ref.number }));
        try {
          const pr = await api.ghPrDiff({ projectPath }, ref.number);
          await startReviewChat(buildPrReviewPrompt(pr));
          showToast(tr("reviewPr.ready", { number: pr.number, files: pr.changedFiles }));
        } catch (error) {
          showToast(tr("reviewPr.failed", { reason: String(error) }), 6000);
        }
      },
    });
  }, [activeProjectPath, openDialog, showToast, startReviewChat, tr]);

  const postPrComment = useCallback(
    (slug: string, pr: api.GhPullRequest) => {
      openDialog({
        kind: "prompt",
        title: tr("pr.commentTitle"),
        message: tr("pr.commentHint"),
        initial: "",
        placeholder: tr("pr.commentPlaceholder"),
        submitLabel: tr("pr.commentPreview"),
        onSubmit: (value) => {
          const lines = value.split(/\r?\n/);
          const match = /^(.*?):(\d+)(?::(LEFT|RIGHT))?\s*$/.exec((lines.shift() || "").trim());
          const body = lines.join("\n").trim();
          const line = match ? Number(match[2]) : 0;
          if (!match || !line || !body) {
            showToast(tr("pr.commentBadFormat"), 4500);
            return;
          }
          const path = match[1]!.trim();
          const side = (match[3] || "RIGHT") as "LEFT" | "RIGHT";
          openDialog({
            kind: "confirm",
            title: tr("pr.commentConfirmTitle"),
            message: tr("pr.commentConfirm", {
              repo: slug,
              number: pr.number,
              path,
              line,
              side,
              body,
            }),
            confirmLabel: tr("pr.commentPublish"),
            danger: true,
            onConfirm: async () => {
              try {
                await api.ghPrComment({ repo: slug, number: pr.number, path, line, side, body });
                showToast(tr("pr.commentPublished"), 4200);
              } catch (error) {
                showToast(tr("pr.commentFailed", { reason: String(error) }), 6000);
              }
            },
          });
        },
      });
    },
    [openDialog, showToast, tr],
  );

  const startMultiReview = useCallback(
    (slug: string, pr: api.GhPullRequest) => {
      void (async () => {
        try {
          const full = await api.ghPrDiff({ repo: slug }, pr.number);
          const preferred = reviewModelId ? [reviewModelId] : [];
          const role = reviewRoleModelId ? [reviewRoleModelId] : [];
          const otherModels = availableModels.map((model) => model.id).filter((id) => id !== "auto");
          const ids = [...new Set([...preferred, ...role, ...otherModels])].slice(0, 4);
          if (ids.length < 2) {
            showToast(tr("pr.multiReviewNeedModels"), 4500);
            return;
          }
          const prompt = buildPrReviewPrompt(full);
          await runBatch(ids.map((id) => ({
            title: `${tr("pr.multiReviewTitle")} · ${availableModels.find((model) => model.id === id)?.label ?? id}`,
            prompt,
            modelId: id,
          })));
          setComparisonOpen(true);
        } catch (error) {
          showToast(tr("reviewPr.failed", { reason: String(error) }), 6000);
        }
      })();
    },
    [availableModels, reviewModelId, reviewRoleModelId, runBatch, setComparisonOpen, showToast, tr],
  );

  return { openReviewPrDialog, postPrComment, startMultiReview };
}
