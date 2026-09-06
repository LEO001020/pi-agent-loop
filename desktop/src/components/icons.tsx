/**
 * App icons — Tabler Icons only (https://tabler.io/icons).
 * Stable `Icon*` names for call sites. No other icon libraries / local SVG packs.
 */

import type { ComponentType } from "react";
import {
  IconActivity as TbActivity,
  IconAlertTriangle as TbAlertTriangle,
  IconArchive as TbArchive,
  IconArrowBackUp as TbArrowBackUp,
  IconArrowLeft as TbArrowLeft,
  IconArrowRight as TbArrowRight,
  IconArrowsMinimize as TbArrowsMinimize,
  IconBolt as TbBolt,
  IconGitBranch as TbGitBranch,
  IconBox as TbBox,
  IconBrush as TbBrush,
  IconCode as TbCode,
  IconGitPullRequest as TbGitPullRequest,
  IconCalendarTime as TbCalendarTime,
  IconCheck as TbCheck,
  IconClipboardList as TbClipboardList,
  IconClock as TbClock,
  IconChevronDown as TbChevronDown,
  IconChevronLeft as TbChevronLeft,
  IconChevronRight as TbChevronRight,
  IconChevronsLeft as TbChevronsLeft,
  IconCircleDashed as TbCircleDashed,
  IconCopy as TbCopy,
  IconDots as TbDots,
  IconEdit as TbEdit,
  IconFileDiff as TbFileDiff,
  IconFileText as TbFileText,
  IconFiles as TbFiles,
  IconFirstAidKit as TbFirstAidKit,
  IconFolder as TbFolder,
  IconFolderPlus as TbFolderPlus,
  IconHandStop as TbHandStop,
  IconInfoCircle as TbInfoCircle,
  IconKeyboard as TbKeyboard,
  IconLanguage as TbLanguage,
  IconExternalLink as TbExternalLink,
  IconLayoutSidebar as TbLayoutSidebar,
  IconLayoutSidebarRight as TbLayoutSidebarRight,
  IconLink as TbLink,
  IconList as TbList,
  IconListTree as TbListTree,
  IconMarkdown as TbMarkdown,
  IconMessage as TbMessage,
  IconMicrophone as TbMicrophone,
  IconHeadphones as TbHeadphones,
  IconMinus as TbMinus,
  IconMoon as TbMoon,
  IconNotes as TbNotes,
  IconPaperclip as TbPaperclip,
  IconPencil as TbPencil,
  IconPinned as TbPinned,
  IconPinnedOff as TbPinnedOff,
  IconPlayerStop as TbPlayerStop,
  IconPlug as TbPlug,
  IconPlus as TbPlus,
  IconPuzzle as TbPuzzle,
  IconRefresh as TbRefresh,
  IconRobot as TbRobot,
  IconSearch as TbSearch,
  IconSend as TbSend,
  IconSettings as TbSettings,
  IconShield as TbShield,
  IconShieldCheck as TbShieldCheck,
  IconSparkles as TbSparkles,
  IconSquare as TbSquare,
  IconStack2 as TbStack2,
  IconSun as TbSun,
  IconTarget as TbTarget,
  IconTerminal2 as TbTerminal2,
  IconThumbDown as TbThumbDown,
  IconThumbUp as TbThumbUp,
  IconTool as TbTool,
  IconTrash as TbTrash,
  IconUpload as TbUpload,
  IconUser as TbUser,
  IconWand as TbWand,
  IconWorld as TbWorld,
  IconX as TbX,
} from "@tabler/icons-react";

export type IconProps = {
  size?: number;
  title?: string;
  className?: string;
  stroke?: number;
  /** @deprecated No-op; call-site compatibility with previous icon APIs. */
  animated?: boolean;
  /** @deprecated No-op; call-site compatibility with Phosphor weight. */
  weight?: string;
};

type TbIcon = ComponentType<{
  size?: number | string;
  stroke?: number;
  color?: string;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

function wrap(Tb: TbIcon, defaults?: { stroke?: number; className?: string }) {
  function TablerAppIcon({
    size = 18,
    title,
    stroke = defaults?.stroke ?? 1.75,
    className = "",
    animated: _a,
    weight: _w,
  }: IconProps) {
    const classes = ["g-icon", defaults?.className, className]
      .filter(Boolean)
      .join(" ");
    return (
      <span
        className={classes}
        style={{
          display: "inline-flex",
          width: size,
          height: size,
          lineHeight: 0,
          color: "currentColor",
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
        }}
        role={title ? "img" : undefined}
        aria-hidden={title ? undefined : true}
        aria-label={title}
        title={title}
      >
        <Tb size={size} stroke={stroke} color="currentColor" aria-hidden />
      </span>
    );
  }
  return TablerAppIcon;
}

/** Official Pi mark, rendered as a bare currentColor glyph. */
export function IconPiMark({
  size = 22,
  title = "Pi",
  className = "",
}: IconProps) {
  const classes = ["g-icon", "g-icon--pi-mark", className]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={classes}
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        lineHeight: 0,
        color: "currentColor",
        flexShrink: 0,
        alignItems: "center",
        justifyContent: "center",
      }}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      title={title}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 800 800"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
        />
        <path d="M517.36 400H634.72V634.72H517.36Z" />
      </svg>
    </span>
  );
}

export const IconCollapse = wrap(TbChevronsLeft);
export const IconSearch = wrap(TbSearch);
/** New chat / compose — Tabler Edit (pencil writing on paper). */
export const IconNewChat = wrap(TbEdit);
export const IconEdit = wrap(TbEdit);
export const IconNotes = wrap(TbNotes);
export const IconImagine = wrap(TbWand);
export const IconAutomations = wrap(TbBolt);
/** Scheduled nav — calendar clock. */
export const IconScheduled = wrap(TbCalendarTime);
export const IconClock = wrap(TbClock);
export const IconSkills = wrap(TbTool);
/** Lifecycle hooks (PreToolUse / SessionStart, …). */
export const IconHooks = wrap(TbBolt);
export const IconChevronDown = wrap(TbChevronDown);
export const IconChevronLeft = wrap(TbChevronLeft);
export const IconChevronRight = wrap(TbChevronRight);
export const IconFolderPlus = wrap(TbFolderPlus);
export const IconPlus = wrap(TbPlus);
export const IconMore = wrap(TbDots);
export const IconFolder = wrap(TbFolder);
export const IconRename = wrap(TbPencil);
export const IconShare = wrap(TbLink);
export const IconTrash = wrap(TbTrash, { className: "g-icon--danger" });
export const IconPaperclip = wrap(TbPaperclip);
export const IconAttach = wrap(TbPaperclip);
export const IconClose = wrap(TbX);
export const IconSend = wrap(TbSend);
export const IconQueue = wrap(TbStack2);
export const IconMic = wrap(TbMicrophone);
export const IconLiveVoice = wrap(TbHeadphones);
/** Workspace switcher (sidebar foot): code / pull requests. */
export const IconWorkspaceCode = wrap(TbCode);
export const IconWorkspacePr = wrap(TbGitPullRequest);

export const IconPanel = wrap(TbLayoutSidebar);
/** Right files / context pane (Codex-style top bar). */
export const IconPanelRight = wrap(TbLayoutSidebarRight);
/** Open project in Finder / external app. */
export const IconExternalLink = wrap(TbExternalLink);
export const IconList = wrap(TbList);
export const IconInstructions = wrap(TbFileText);
export const IconSettings = wrap(TbSettings);
export const IconDoctor = wrap(TbFirstAidKit);
export const IconThemeSun = wrap(TbSun);
export const IconThemeMoon = wrap(TbMoon);
export const IconStop = wrap(TbPlayerStop);
export const IconHistory = wrap(TbRefresh);
/** Session rewind / undo conversation tail. */
export const IconRewind = wrap(TbArrowBackUp);
/** Session fork / branch. */
export const IconFork = wrap(TbGitBranch);
export const IconUpload = wrap(TbUpload);
export const IconFiles = wrap(TbFiles);
export const IconWorld = wrap(TbWorld);
export const IconTerminal = wrap(TbTerminal2);
/** Session changes / diff panel (resource viewer). */
export const IconFileDiff = wrap(TbFileDiff);
/** File tree panel toggle (resource viewer). */
export const IconListTree = wrap(TbListTree);
export const IconFileUp = wrap(TbUpload);
export const IconCart = wrap(TbBolt);
export const IconThumbsUp = wrap(TbThumbUp);
export const IconThumbsDown = wrap(TbThumbDown);
export const IconRefresh = wrap(TbRefresh);
export const IconCopy = wrap(TbCopy);
export const IconExportMd = wrap(TbMarkdown);
export const IconArchive = wrap(TbArchive);
export const IconChat = wrap(TbMessage);
export const IconFileText = wrap(TbFileText);
export const IconBolt = wrap(TbBolt);
export const IconMinimize = wrap(TbMinus);
export const IconMaximize = wrap(TbSquare);
export const IconPlan = wrap(TbList);
export const IconPin = wrap(TbPinned);
export const IconPinOff = wrap(TbPinnedOff);
export const IconHandStop = wrap(TbHandStop);
export const IconShield = wrap(TbShield);
export const IconShieldCheck = wrap(TbShieldCheck);
export const IconAlertTriangle = wrap(TbAlertTriangle);
export const IconCheck = wrap(TbCheck);
export const IconRobot = wrap(TbRobot);
export const IconArrowLeft = wrap(TbArrowLeft);
export const IconArrowRight = wrap(TbArrowRight);
export const IconArrowBackUp = wrap(TbArrowBackUp);
export const IconUser = wrap(TbUser);
export const IconAppearance = wrap(TbBrush);
export const IconLanguage = wrap(TbLanguage);
export const IconInfo = wrap(TbInfoCircle);
export const IconKeyboard = wrap(TbKeyboard);
/** Slash palette / goal mode */
export const IconTarget = wrap(TbTarget);
export const IconClipboardList = wrap(TbClipboardList);
export const IconArrowsMinimize = wrap(TbArrowsMinimize);
export const IconCircleDashed = wrap(TbCircleDashed);
export const IconPlug = wrap(TbPlug);
export const IconActivity = wrap(TbActivity);
export const IconSparkles = wrap(TbSparkles);
export const IconBox = wrap(TbBox);
export const IconPuzzle = wrap(TbPuzzle);
