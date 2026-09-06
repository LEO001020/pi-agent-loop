import { describe, expect, it } from "vitest";
import {
  applyResolvedSessionMedia,
  buildAgentPrompt,
  buildInlineMediaPathMap,
  extractMediaPathsFromContent,
  extractSessionRelativeMediaRefs,
  filterAttachmentsNotInlined,
  isImagePath,
  isMediaPath,
  isVideoPath,
  joinSessionMediaPath,
  mergeAttachments,
  mergeMessageAttachments,
  parseAttachmentsFromContent,
  pathBasename,
  resolveInlineMediaToken,
  resolveMediaHref,
  type Attachment,
} from "./attachments";

const file: Attachment = {
  path: "/tmp/a.txt",
  name: "a.txt",
  isDir: false,
};
const dir: Attachment = {
  path: "/tmp/proj",
  name: "proj",
  isDir: true,
};

describe("attachments", () => {
  it("dedupes by path", () => {
    const out = mergeAttachments([file], [{ ...file, name: "renamed" }, dir]);
    expect(out).toHaveLength(2);
    expect(out.find((a) => a.path === file.path)?.name).toBe("renamed");
  });

  it("builds agent prompt with @paths", () => {
    expect(buildAgentPrompt("hi", [file, dir])).toBe(
      "hi\n\n@/tmp/a.txt\n@/tmp/proj",
    );
    expect(buildAgentPrompt("", [file])).toBe("@/tmp/a.txt");
  });

  it("parses @paths back out of content", () => {
    const raw = "hello\n\n@/Users/me/pic.png\n@/Users/me/docs";
    const { text, attachments } = parseAttachmentsFromContent(raw);
    expect(text).toBe("hello");
    expect(attachments).toHaveLength(2);
    expect(attachments[0]!.path).toBe("/Users/me/pic.png");
    expect(attachments[0]!.name).toBe("pic.png");
  });

  it("detects image and video extensions", () => {
    expect(isImagePath("/a/b.PNG")).toBe(true);
    expect(isImagePath("/a/b.docx")).toBe(false);
    expect(isVideoPath("/a/b.mp4")).toBe(true);
    expect(isVideoPath("/a/b.mov")).toBe(true);
    expect(isMediaPath("/a/b.webm")).toBe(true);
    expect(isMediaPath("/a/b.txt")).toBe(false);
  });

  it("basename works", () => {
    expect(pathBasename("/foo/bar/baz.txt")).toBe("baz.txt");
  });

  it("extracts absolute media paths from assistant prose", () => {
    const content = `完整路径：

\`/Users/me/Library/Application Support/dev.pi.pi-app/agent-home/sessions/abc/images/1.jpg\`

also /tmp/other.png and /tmp/clip.mp4 and not a file.`;
    const atts = extractMediaPathsFromContent(content);
    expect(atts.map((a) => a.path)).toEqual([
      "/Users/me/Library/Application Support/dev.pi.pi-app/agent-home/sessions/abc/images/1.jpg",
      "/tmp/other.png",
      "/tmp/clip.mp4",
    ]);
    expect(atts[0]!.name).toBe("1.jpg");
  });

  it("mergeMessageAttachments combines stored + text paths", () => {
    const out = mergeMessageAttachments(
      [{ path: "/a.png", name: "a.png", isDir: false }],
      "see `/b.jpg`",
    );
    expect(out).toHaveLength(2);
    expect(out?.map((a) => a.path).sort()).toEqual(["/a.png", "/b.jpg"]);
  });

  it("extracts Pi short session-relative media refs", () => {
    const content = `图片已生成：

**\`images/1.jpg\`**

画面是一只小猫`;
    expect(extractSessionRelativeMediaRefs(content)).toEqual(["images/1.jpg"]);
    expect(extractSessionRelativeMediaRefs("also images/2.png ok")).toEqual([
      "images/2.png",
    ]);
    expect(extractSessionRelativeMediaRefs("/abs/images/1.jpg")).toEqual([]);
    // Markdown link form
    expect(
      extractSessionRelativeMediaRefs(
        "已生成：\n\n**[images/1.jpg](images/1.jpg)**\n",
      ),
    ).toEqual(["images/1.jpg"]);
    // Video short paths
    expect(
      extractSessionRelativeMediaRefs(
        "视频：\n\n**[videos/1.mp4](videos/1.mp4)**\n",
      ),
    ).toEqual(["videos/1.mp4"]);
    expect(extractSessionRelativeMediaRefs("`videos/2.webm`")).toEqual([
      "videos/2.webm",
    ]);
    // Skill output under project cwd (xhx-media-gen etc.)
    expect(
      extractSessionRelativeMediaRefs(
        "**本地文件：**\n`outputs/xhx-media-gen/kitten-drinking-water-cartoon-grotesque.png`\n",
      ),
    ).toEqual([
      "outputs/xhx-media-gen/kitten-drinking-water-cartoon-grotesque.png",
    ]);
  });

  it("resolveMediaHref maps link href to absolute via path map", () => {
    const map = {
      "images/1.jpg": "/sess/images/1.jpg",
      "videos/1.mp4": "/sess/videos/1.mp4",
    };
    expect(resolveMediaHref("images/1.jpg", "images/1.jpg", map)).toBe(
      "/sess/images/1.jpg",
    );
    expect(resolveMediaHref("videos/1.mp4", "clip", map)).toBe(
      "/sess/videos/1.mp4",
    );
    expect(resolveMediaHref("https://example.com", "x", map)).toBeNull();
  });

  it("joins session media root with relative path", () => {
    expect(
      joinSessionMediaPath(
        "/Users/me/agent-home/sessions/abc/019f",
        "images/1.jpg",
      ),
    ).toBe("/Users/me/agent-home/sessions/abc/019f/images/1.jpg");
    expect(
      joinSessionMediaPath(
        "/Users/me/agent-home/sessions/abc/019f",
        "videos/1.mp4",
      ),
    ).toBe("/Users/me/agent-home/sessions/abc/019f/videos/1.mp4");
  });

  it("applyResolvedSessionMedia attaches cards for short paths", () => {
    const msgs = [
      {
        role: "assistant" as const,
        content: "已生成\n\n**`images/1.jpg`**\n\nand `videos/1.mp4`",
        attachments: undefined as Attachment[] | undefined,
      },
    ];
    const resolved: Attachment[] = [
      { path: "/sess/images/1.jpg", name: "1.jpg", isDir: false },
      { path: "/sess/videos/1.mp4", name: "1.mp4", isDir: false },
    ];
    const out = applyResolvedSessionMedia(msgs, resolved);
    expect(out[0]!.attachments).toHaveLength(2);
    expect(out[0]!.attachments!.map((a) => a.path).sort()).toEqual([
      "/sess/images/1.jpg",
      "/sess/videos/1.mp4",
    ]);
  });

  it("buildInlineMediaPathMap maps short tokens to absolute", () => {
    const map = buildInlineMediaPathMap([
      { path: "/sess/images/1.jpg", name: "1.jpg", isDir: false },
      { path: "/sess/videos/1.mp4", name: "1.mp4", isDir: false },
    ]);
    expect(map["images/1.jpg"]).toBe("/sess/images/1.jpg");
    expect(map["videos/1.mp4"]).toBe("/sess/videos/1.mp4");
    expect(resolveInlineMediaToken("videos/1.mp4", map)).toBe(
      "/sess/videos/1.mp4",
    );
  });

  it("filterAttachmentsNotInlined drops media already in body text", () => {
    const atts: Attachment[] = [
      { path: "/sess/images/1.jpg", name: "1.jpg", isDir: false },
      { path: "/sess/videos/1.mp4", name: "1.mp4", isDir: false },
      { path: "/sess/notes.txt", name: "notes.txt", isDir: false },
    ];
    const out = filterAttachmentsNotInlined(
      "图片：\n\n**`images/1.jpg`**\n视频：\n**[videos/1.mp4](videos/1.mp4)**\n",
      atts,
    );
    expect(out).toHaveLength(1);
    expect(out![0]!.name).toBe("notes.txt");
  });
});
