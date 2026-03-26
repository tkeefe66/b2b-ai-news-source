import { google } from "googleapis";

/**
 * Google Drive OAuth2 authentication.
 *
 * Required environment variables:
 *   GOOGLE_CLIENT_ID      - OAuth2 client ID from Google Cloud Console
 *   GOOGLE_CLIENT_SECRET  - OAuth2 client secret
 *   GOOGLE_REDIRECT_URI   - Authorized redirect URI (e.g. http://localhost:5000/api/auth/google/callback)
 *   GOOGLE_REFRESH_TOKEN  - Long-lived refresh token obtained via the OAuth2 consent flow
 *
 * TODO: Set up a Google Cloud project, enable Drive/Docs/Slides APIs, create OAuth2
 * credentials, and run the consent flow once to obtain a refresh token.
 * See: https://developers.google.com/identity/protocols/oauth2
 */

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:5000/api/auth/google/callback";

  if (!clientId || !clientSecret) {
    throw new Error(
      "Google Drive is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN environment variables."
    );
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error(
      "Google Drive is not authorized. Set the GOOGLE_REFRESH_TOKEN environment variable. " +
      "Visit /api/auth/google to start the OAuth2 consent flow."
    );
  }

  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

function clearCachedToken() {
  // No-op: OAuth2 client handles token refresh automatically
}

async function getAuth(_forceRefresh = false) {
  return getOAuthClient();
}

async function withAuthRetry<T>(fn: (forceRefresh: boolean) => Promise<T>): Promise<T> {
  try {
    return await fn(false);
  } catch (err: any) {
    const msg = (err?.message || "").toLowerCase();
    const code = err?.code || err?.response?.status;
    if (code === 401 || code === 403 || msg.includes("invalid credentials") || msg.includes("token") || msg.includes("unauthorized")) {
      console.log("[google-drive] Auth error, retrying...");
      clearCachedToken();
      outputFolderId = null;
      return await fn(true);
    }
    throw err;
  }
}

export async function getUncachableGoogleDriveClient(forceRefresh = false) {
  const auth = await getAuth(forceRefresh);
  return google.drive({ version: "v3", auth });
}

export async function getUncachableDocsClient(forceRefresh = false) {
  const auth = await getAuth(forceRefresh);
  return google.docs({ version: "v1", auth });
}

export async function getUncachableSlidesClient(forceRefresh = false) {
  const auth = await getAuth(forceRefresh);
  return google.slides({ version: "v1", auth });
}

let outputFolderId: string | null = null;

export async function listDriveFiles(query?: string, pageToken?: string, folderId?: string): Promise<{
  files: Array<{ id: string; name: string; mimeType: string; size: string; modifiedTime: string; iconLink: string }>;
  nextPageToken?: string;
}> {
  return withAuthRetry(async (forceRefresh) => {
    const drive = await getUncachableGoogleDriveClient(forceRefresh);

    const supportedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.presentation",
      "text/plain",
      "video/mp4",
      "video/quicktime",
      "video/webm",
    ];

    let q = "trashed = false";
    if (folderId) {
      q += ` and '${folderId}' in parents`;
    }

    const mimeFilter = supportedTypes.map(t => `mimeType = '${t}'`).join(" or ");
    const folderFilter = `mimeType = 'application/vnd.google-apps.folder'`;
    q += ` and (${mimeFilter} or ${folderFilter})`;

    if (query) {
      q += ` and name contains '${query.replace(/'/g, "\\'")}'`;
    }

    const res = await drive.files.list({
      q,
      pageSize: 30,
      pageToken: pageToken || undefined,
      fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, iconLink)",
      orderBy: "modifiedTime desc",
    });

    return {
      files: (res.data.files || []).map(f => ({
        id: f.id!,
        name: f.name!,
        mimeType: f.mimeType!,
        size: f.size || "0",
        modifiedTime: f.modifiedTime || "",
        iconLink: f.iconLink || "",
      })),
      nextPageToken: res.data.nextPageToken || undefined,
    };
  });
}

export async function downloadDriveFile(fileId: string): Promise<{ buffer: Buffer; name: string; mimeType: string }> {
  return withAuthRetry(async (forceRefresh) => {
    const drive = await getUncachableGoogleDriveClient(forceRefresh);

    const meta = await drive.files.get({ fileId, fields: "name, mimeType, size" });
    const name = meta.data.name!;
    const mimeType = meta.data.mimeType!;

    if (mimeType === "application/vnd.google-apps.document") {
      const res = await drive.files.export(
        { fileId, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        { responseType: "arraybuffer" }
      );
      return {
        buffer: Buffer.from(res.data as ArrayBuffer),
        name: name.endsWith(".docx") ? name : name + ".docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }

    if (mimeType === "application/vnd.google-apps.presentation") {
      const res = await drive.files.export(
        { fileId, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
        { responseType: "arraybuffer" }
      );
      return {
        buffer: Buffer.from(res.data as ArrayBuffer),
        name: name.endsWith(".pptx") ? name : name + ".pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      };
    }

    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );
    return {
      buffer: Buffer.from(res.data as ArrayBuffer),
      name,
      mimeType,
    };
  });
}

export async function getOrCreateOutputFolder(): Promise<string> {
  if (outputFolderId) return outputFolderId;

  const drive = await getUncachableGoogleDriveClient();

  const existing = await drive.files.list({
    q: "name = 'Field Enablement Output' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    fields: "files(id, name)",
    spaces: "drive",
  });

  if (existing.data.files && existing.data.files.length > 0) {
    outputFolderId = existing.data.files[0].id!;
    return outputFolderId;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: "Field Enablement Output",
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });

  outputFolderId = folder.data.id!;
  return outputFolderId;
}

export async function createGoogleDoc(
  title: string,
  markdownContent: string,
): Promise<{ id: string; url: string }> {
  return withAuthRetry(async (forceRefresh) => {
    const folderId = await getOrCreateOutputFolder();
    const drive = await getUncachableGoogleDriveClient(forceRefresh);
    const docs = await getUncachableDocsClient(forceRefresh);

    const file = await drive.files.create({
      requestBody: {
        name: title,
        mimeType: "application/vnd.google-apps.document",
        parents: [folderId],
      },
      fields: "id, webViewLink",
    });

    const docId = file.data.id!;
    const url = file.data.webViewLink!;

    const requests = markdownToDocRequests(markdownContent);
    if (requests.length > 0) {
      await docs.documents.batchUpdate({
        documentId: docId,
        requestBody: { requests },
      });
    }

    return { id: docId, url };
  });
}

function markdownToDocRequests(markdown: string): any[] {
  const lines = markdown.split("\n");
  const requests: any[] = [];
  let index = 1;

  for (const line of lines) {
    let text = line;
    let style: any = null;

    if (line.startsWith("### ")) {
      text = line.slice(4);
      style = { namedStyleType: "HEADING_3" };
    } else if (line.startsWith("## ")) {
      text = line.slice(3);
      style = { namedStyleType: "HEADING_2" };
    } else if (line.startsWith("# ")) {
      text = line.slice(2);
      style = { namedStyleType: "HEADING_1" };
    } else if (line.startsWith("---")) {
      text = "\n";
    }

    text = text.replace(/\*\*(.*?)\*\*/g, "$1");
    const insertText = text + "\n";

    requests.push({
      insertText: {
        location: { index },
        text: insertText,
      },
    });

    if (style) {
      requests.push({
        updateParagraphStyle: {
          range: { startIndex: index, endIndex: index + insertText.length },
          paragraphStyle: style,
          fields: "namedStyleType",
        },
      });
    }

    const boldRegex = /\*\*(.*?)\*\*/g;
    let match;
    const originalLine = line.startsWith("#") ? line.replace(/^#+\s/, "") : line;
    let searchIndex = 0;
    while ((match = boldRegex.exec(originalLine)) !== null) {
      const boldText = match[1];
      const pos = text.indexOf(boldText, searchIndex);
      if (pos !== -1) {
        requests.push({
          updateTextStyle: {
            range: {
              startIndex: index + pos,
              endIndex: index + pos + boldText.length,
            },
            textStyle: { bold: true },
            fields: "bold",
          },
        });
        searchIndex = pos + boldText.length;
      }
    }

    index += insertText.length;
  }

  return requests;
}

const EMU = 914400;
const SLIDE_W = 10 * EMU;
const SLIDE_H = 5.625 * EMU;

const C = {
  MIDNIGHT: { red: 13 / 255, green: 24 / 255, blue: 70 / 255 },
  SKY: { red: 76 / 255, green: 163 / 255, blue: 255 / 255 },
  SUNSET: { red: 255 / 255, green: 124 / 255, blue: 51 / 255 },
  WHITE: { red: 1, green: 1, blue: 1 },
  CLOUD: { red: 248 / 255, green: 250 / 255, blue: 252 / 255 },
  LAVENDER: { red: 142 / 255, green: 111 / 255, blue: 214 / 255 },
  MIDNIGHT_LIGHT: { red: 30 / 255, green: 42 / 255, blue: 90 / 255 },
  SKY_LIGHT: { red: 76 / 255, green: 163 / 255, blue: 255 / 255, alpha: 0.15 },
  TRANSPARENT: { red: 0, green: 0, blue: 0 },
};

function rgb(c: { red: number; green: number; blue: number }) {
  return { rgbColor: c };
}

function emu(inches: number) {
  return Math.round(inches * EMU);
}

function shapeId(slideIdx: number, name: string) {
  return `s${slideIdx}_${name}`;
}

const SHAPE_MIN = 3000000;

function createShape(
  slideId: string,
  objectId: string,
  x: number, y: number, w: number, h: number,
  type: string = "RECTANGLE"
): any {
  const safeW = Math.max(w, 1);
  const safeH = Math.max(h, 1);
  const sizeW = Math.max(safeW, SHAPE_MIN);
  const sizeH = Math.max(safeH, SHAPE_MIN);
  const scaleX = safeW / sizeW;
  const scaleY = safeH / sizeH;

  return {
    createShape: {
      objectId,
      shapeType: type,
      elementProperties: {
        pageObjectId: slideId,
        size: { width: { magnitude: sizeW, unit: "EMU" }, height: { magnitude: sizeH, unit: "EMU" } },
        transform: {
          scaleX, scaleY, translateX: x, translateY: y, unit: "EMU",
        },
      },
    },
  };
}

function fillShape(objectId: string, color: any): any[] {
  return [
    {
      updateShapeProperties: {
        objectId,
        shapeProperties: {
          shapeBackgroundFill: {
            solidFill: { color: rgb(color) },
          },
        },
        fields: "shapeBackgroundFill",
      },
    },
    {
      updateShapeProperties: {
        objectId,
        shapeProperties: {
          outline: { propertyState: "NOT_RENDERED" },
        },
        fields: "outline",
      },
    },
  ];
}

function insertText(objectId: string, text: string): any {
  return { insertText: { objectId, text, insertionIndex: 0 } };
}

function styleText(
  objectId: string,
  opts: {
    fontFamily?: string;
    fontSize?: number;
    color?: any;
    bold?: boolean;
    italic?: boolean;
  }
): any {
  const style: any = {};
  const fields: string[] = [];

  if (opts.fontFamily) { style.fontFamily = opts.fontFamily; fields.push("fontFamily"); }
  if (opts.fontSize) { style.fontSize = { magnitude: opts.fontSize, unit: "PT" }; fields.push("fontSize"); }
  if (opts.color) { style.foregroundColor = { opaqueColor: rgb(opts.color) }; fields.push("foregroundColor"); }
  if (opts.bold !== undefined) { style.bold = opts.bold; fields.push("bold"); }
  if (opts.italic !== undefined) { style.italic = opts.italic; fields.push("italic"); }

  return {
    updateTextStyle: {
      objectId,
      style,
      fields: fields.join(","),
      textRange: { type: "ALL" },
    },
  };
}

function alignText(objectId: string, alignment: string): any {
  return {
    updateParagraphStyle: {
      objectId,
      style: { alignment },
      fields: "alignment",
      textRange: { type: "ALL" },
    },
  };
}

function styleTextRange(
  objectId: string,
  startIndex: number,
  endIndex: number,
  opts: { fontFamily?: string; fontSize?: number; color?: any; bold?: boolean; italic?: boolean }
): any {
  const style: any = {};
  const fields: string[] = [];
  if (opts.fontFamily) { style.fontFamily = opts.fontFamily; fields.push("fontFamily"); }
  if (opts.fontSize) { style.fontSize = { magnitude: opts.fontSize, unit: "PT" }; fields.push("fontSize"); }
  if (opts.color) { style.foregroundColor = { opaqueColor: rgb(opts.color) }; fields.push("foregroundColor"); }
  if (opts.bold !== undefined) { style.bold = opts.bold; fields.push("bold"); }
  if (opts.italic !== undefined) { style.italic = opts.italic; fields.push("italic"); }
  return {
    updateTextStyle: {
      objectId,
      style,
      fields: fields.join(","),
      textRange: { type: "FIXED_RANGE", startIndex, endIndex },
    },
  };
}

function cleanLine(line: string): string {
  let cleaned = line
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/^#+\s*/, "")
    .replace(/^---+$/, "")
    .replace(/^\s{4,}[-*]\s+/, "")
    .replace(/^\s*[-*]\s+/, "\u2022 ")
    .replace(/^\d+\.\s+/, "")
    .trim();
  if (cleaned.startsWith("\u2022") && cleaned.length > 120) {
    cleaned = cleaned.substring(0, 117) + "...";
  }
  return cleaned;
}

function truncateBodyForSlide(text: string, maxLines: number = 12): string {
  const lines = text.split("\n").filter(l => l.trim());
  return lines.slice(0, maxLines).join("\n");
}

interface BodySegment {
  text: string;
  isSubheading: boolean;
}

function parseBodySegments(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  const lines = body.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const isSubheading = (
      !trimmed.startsWith("\u2022") &&
      trimmed.length < 100 &&
      (
        trimmed.endsWith(":") ||
        /^[A-Z][^.!?•]*$/.test(trimmed) ||
        /^(Objection|Response|Challenge|Solution|Problem|Approach|Result|Outcome|Before|After|Why|How|When|Key|Impact|Takeaway):/i.test(trimmed)
      )
    );
    segments.push({ text: trimmed, isSubheading });
  }
  return segments;
}

function buildTitleSlide(slideId: string, idx: number, title: string, subtitle: string): any[] {
  const reqs: any[] = [];

  reqs.push({
    updatePageProperties: {
      objectId: slideId,
      pageProperties: {
        pageBackgroundFill: { solidFill: { color: rgb(C.WHITE) } },
      },
      fields: "pageBackgroundFill.solidFill.color",
    },
  });

  const leftBlockId = shapeId(idx, "left_block");
  reqs.push(createShape(slideId, leftBlockId, 0, 0, emu(0.35), SLIDE_H));
  reqs.push(...fillShape(leftBlockId, C.MIDNIGHT));

  const titleId = shapeId(idx, "title");
  reqs.push(createShape(slideId, titleId, emu(0.8), emu(1.2), emu(7.5), emu(1.8)));
  reqs.push(...fillShape(titleId, C.WHITE));
  reqs.push(insertText(titleId, title));
  reqs.push(styleText(titleId, { fontFamily: "Roboto Serif", fontSize: 36, color: C.MIDNIGHT, bold: true }));

  if (subtitle) {
    const subtitleId = shapeId(idx, "subtitle");
    reqs.push(createShape(slideId, subtitleId, emu(0.8), emu(3.2), emu(7.5), emu(0.8)));
    reqs.push(...fillShape(subtitleId, C.WHITE));
    reqs.push(insertText(subtitleId, subtitle));
    reqs.push(styleText(subtitleId, { fontFamily: "Roboto", fontSize: 16, color: C.MIDNIGHT }));
  }

  const bottomBarId = shapeId(idx, "bottom_bar");
  reqs.push(createShape(slideId, bottomBarId, 0, SLIDE_H - emu(0.06), SLIDE_W, emu(0.06)));
  reqs.push(...fillShape(bottomBarId, C.SKY));

  return reqs;
}

function buildContentSlide(slideId: string, idx: number, data: SlideData, slideNum: number, totalSlides: number): any[] {
  const reqs: any[] = [];

  reqs.push({
    updatePageProperties: {
      objectId: slideId,
      pageProperties: {
        pageBackgroundFill: { solidFill: { color: rgb(C.WHITE) } },
      },
      fields: "pageBackgroundFill.solidFill.color",
    },
  });

  const titleId = shapeId(idx, "title");
  reqs.push(createShape(slideId, titleId, emu(0.7), emu(0.4), emu(8.6), emu(0.65)));
  reqs.push(...fillShape(titleId, C.WHITE));
  reqs.push(insertText(titleId, data.title));
  reqs.push(styleText(titleId, { fontFamily: "Roboto Serif", fontSize: 24, color: C.MIDNIGHT, bold: true }));

  if (data.body) {
    const segments = parseBodySegments(truncateBodyForSlide(data.body, 10));
    const bodyText = segments.map(s => s.text).join("\n");
    const lineCount = bodyText.split("\n").length;
    const fontSize = lineCount > 7 ? 12 : lineCount > 5 ? 13 : 14;
    const bodyId = shapeId(idx, "body");
    reqs.push(createShape(slideId, bodyId, emu(0.7), emu(1.2), emu(8.6), emu(3.8)));
    reqs.push(...fillShape(bodyId, C.WHITE));
    reqs.push(insertText(bodyId, bodyText));
    reqs.push(styleText(bodyId, { fontFamily: "Roboto", fontSize, color: C.MIDNIGHT }));
    reqs.push({
      updateParagraphStyle: {
        objectId: bodyId,
        style: { spaceAbove: { magnitude: 5, unit: "PT" }, lineSpacing: 140 },
        fields: "spaceAbove,lineSpacing",
        textRange: { type: "ALL" },
      },
    });

    let charOffset = 0;
    const totalLen = bodyText.length;
    for (const seg of segments) {
      if (seg.isSubheading) {
        const end = Math.min(charOffset + seg.text.length, totalLen);
        if (charOffset < end) {
          reqs.push(styleTextRange(bodyId, charOffset, end, {
            fontFamily: "Roboto", fontSize: 14, color: C.MIDNIGHT, bold: true,
          }));
        }
      }
      charOffset += seg.text.length + 1;
    }
  }

  return reqs;
}

function buildSlideByLayout(slideId: string, idx: number, data: SlideData, _slideNum: number, _totalSlides: number): any[] {
  return buildContentSlide(slideId, idx, data, _slideNum, _totalSlides);
}

function buildClosingSlide(slideId: string, idx: number, totalSlides: number): any[] {
  const reqs: any[] = [];

  reqs.push({
    updatePageProperties: {
      objectId: slideId,
      pageProperties: {
        pageBackgroundFill: { solidFill: { color: rgb(C.MIDNIGHT) } },
      },
      fields: "pageBackgroundFill.solidFill.color",
    },
  });

  const accentBarId = shapeId(idx, "accent_bottom");
  reqs.push(createShape(slideId, accentBarId, 0, SLIDE_H - emu(0.06), SLIDE_W, emu(0.06)));
  reqs.push(...fillShape(accentBarId, C.SUNSET));

  const accentBar2Id = shapeId(idx, "accent_bottom2");
  reqs.push(createShape(slideId, accentBar2Id, 0, SLIDE_H - emu(0.06), Math.round(SLIDE_W * 0.5), emu(0.06)));
  reqs.push(...fillShape(accentBar2Id, C.SKY));

  const headlineId = shapeId(idx, "headline");
  reqs.push(createShape(slideId, headlineId, emu(1.5), emu(1.4), emu(7.0), emu(1.2)));
  reqs.push(...fillShape(headlineId, C.MIDNIGHT));
  reqs.push(insertText(headlineId, "Thank you"));
  reqs.push(styleText(headlineId, { fontFamily: "Roboto Serif", fontSize: 44, color: C.WHITE, bold: true }));
  reqs.push(alignText(headlineId, "CENTER"));

  const divId = shapeId(idx, "divider");
  reqs.push(createShape(slideId, divId, emu(4.2), emu(2.7), emu(1.6), emu(0.04)));
  reqs.push(...fillShape(divId, C.SUNSET));

  const ctaId = shapeId(idx, "cta");
  reqs.push(createShape(slideId, ctaId, emu(2.0), emu(3.0), emu(6.0), emu(0.8)));
  reqs.push(...fillShape(ctaId, C.MIDNIGHT));
  reqs.push(insertText(ctaId, "Ready to automate your pipeline?\ndemandbase.com"));
  reqs.push(styleText(ctaId, { fontFamily: "Roboto", fontSize: 16, color: C.SKY }));
  reqs.push(alignText(ctaId, "CENTER"));

  const dotId = shapeId(idx, "dot");
  reqs.push(createShape(slideId, dotId, emu(4.85), emu(4.2), emu(0.3), emu(0.3), "ELLIPSE"));
  reqs.push(...fillShape(dotId, C.SUNSET));

  return reqs;
}

export async function createGoogleSlides(
  title: string,
  slidesData: SlideData[],
): Promise<{ id: string; url: string }> {
  return withAuthRetry(async (forceRefresh) => {
  const folderId = await getOrCreateOutputFolder();
  const drive = await getUncachableGoogleDriveClient(forceRefresh);
  const slides = await getUncachableSlidesClient(forceRefresh);

  const file = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: "application/vnd.google-apps.presentation",
      parents: [folderId],
    },
    fields: "id, webViewLink",
  });

  const presId = file.data.id!;
  const url = file.data.webViewLink!;

  const pres = await slides.presentations.get({ presentationId: presId });
  const firstSlideId = pres.data.slides?.[0]?.objectId;

  const firstBodyLines0 = slidesData[0]?.body
    ? slidesData[0].body.split("\n").filter(l => l.trim())
    : [];
  const hasExtraFirstSlide = firstBodyLines0.length > 1;
  const totalContent = hasExtraFirstSlide ? slidesData.length + 1 : slidesData.length;
  const totalSlides = totalContent + 1;
  const allRequests: any[] = [];

  const slideIds: string[] = [];
  const ts = Date.now();
  for (let i = 0; i < totalSlides; i++) {
    const sid = `slide_${i}_${ts}`;
    slideIds.push(sid);
    allRequests.push({
      createSlide: {
        objectId: sid,
        insertionIndex: i,
        slideLayoutReference: { predefinedLayout: "BLANK" },
      },
    });
  }

  if (firstSlideId) {
    allRequests.push({ deleteObject: { objectId: firstSlideId } });
  }

  await slides.presentations.batchUpdate({
    presentationId: presId,
    requestBody: { requests: allRequests },
  });

  const deckTitle = slidesData[0]?.title || title;
  const deckSubtitle = firstBodyLines0[0]?.substring(0, 200) || "";

  const titleReqs = buildTitleSlide(slideIds[0], 0, deckTitle, deckSubtitle);
  await slides.presentations.batchUpdate({
    presentationId: presId,
    requestBody: { requests: titleReqs },
  });

  const notesMap: { slideId: string; notes: string }[] = [];

  let slideCounter = 1;
  if (hasExtraFirstSlide) {
    const sid = slideIds[slideCounter];
    const data: SlideData = { title: slidesData[0].title, body: firstBodyLines0.slice(1).join("\n"), layout: slidesData[0].layout };
    const slideReqs = buildSlideByLayout(sid, slideCounter, data, slideCounter + 1, totalSlides);
    await slides.presentations.batchUpdate({
      presentationId: presId,
      requestBody: { requests: slideReqs },
    });
    if (slidesData[0].speakerNotes) notesMap.push({ slideId: sid, notes: slidesData[0].speakerNotes });
    slideCounter++;
  }

  for (let i = 1; i < slidesData.length; i++) {
    if (slideCounter >= slideIds.length - 1) break;
    const sid = slideIds[slideCounter];
    const slideReqs = buildSlideByLayout(sid, slideCounter, slidesData[i], slideCounter + 1, totalSlides);
    await slides.presentations.batchUpdate({
      presentationId: presId,
      requestBody: { requests: slideReqs },
    });
    if (slidesData[i].speakerNotes) notesMap.push({ slideId: sid, notes: slidesData[i].speakerNotes! });
    slideCounter++;
  }

  const closingReqs = buildClosingSlide(slideIds[totalSlides - 1], totalSlides - 1, totalSlides);
  await slides.presentations.batchUpdate({
    presentationId: presId,
    requestBody: { requests: closingReqs },
  });

  if (notesMap.length > 0) {
    const updatedPres = await slides.presentations.get({ presentationId: presId });
    const notesReqs: any[] = [];
    for (const { slideId: targetSlideId, notes } of notesMap) {
      const slide = updatedPres.data.slides?.find(s => s.objectId === targetSlideId);
      if (!slide?.slideProperties?.notesPage?.pageElements) continue;
      const notesShape = slide.slideProperties.notesPage.pageElements.find(
        (el: any) => el.shape?.placeholder?.type === "BODY"
      );
      if (!notesShape?.objectId) continue;
      notesReqs.push({
        insertText: {
          objectId: notesShape.objectId,
          insertionIndex: 0,
          text: notes,
        },
      });
    }
    if (notesReqs.length > 0) {
      await slides.presentations.batchUpdate({
        presentationId: presId,
        requestBody: { requests: notesReqs },
      });
    }
  }

  return { id: presId, url };
  });
}

export type SlideLayout = "content" | "stats" | "comparison" | "section" | "quote" | "objection" | "callout" | "statement";

export interface SlideData {
  title: string;
  body: string;
  layout?: SlideLayout;
  speakerNotes?: string;
}

const MAX_BODY_LINES = 10;

export function parseAIContentToSlides(content: string): SlideData[] {
  const raw = content.replace(/\r\n/g, "\n").trim();

  let sections = raw.split(/^## /m).filter(s => s.trim());
  if (sections.length <= 1) {
    sections = raw.split(/^# /m).filter(s => s.trim());
  }

  if (sections.length <= 1) {
    sections = raw.split(/^---+$/m).filter(s => s.trim());
  }

  if (sections.length <= 1) {
    sections = raw.split(/(?=^\*\*[A-Z][^*]+\*\*)/m).filter(s => s.trim());
  }

  if (sections.length <= 1) {
    const paragraphs = raw.split(/\n\n\n+/).filter(p => p.trim());
    if (paragraphs.length > 2) {
      sections = paragraphs;
    }
  }

  if (sections.length <= 1) {
    const allLines = raw.split("\n").filter(l => l.trim() && !l.match(/^---+$/));
    const cleaned = allLines.map(l => cleanLine(l)).filter(l => l);
    const chunks: string[][] = [];
    for (let i = 0; i < cleaned.length; i += MAX_BODY_LINES) {
      chunks.push(cleaned.slice(i, i + MAX_BODY_LINES));
    }
    const slides: SlideData[] = [];
    slides.push({
      title: chunks[0]?.[0] || "Demandbase",
      body: (chunks[0]?.slice(1) || []).join("\n"),
    });
    for (let c = 1; c < chunks.length && c < 12; c++) {
      slides.push({
        title: chunks[c][0] || `Section ${c + 1}`,
        body: chunks[c].slice(1).join("\n"),
      });
    }
    return slides;
  }

  const slides: SlideData[] = [];

  for (const section of sections) {
    const lines = section.split("\n");
    let rawTitle = lines[0]
      .replace(/^#+\s*/, "")
      .replace(/\*\*/g, "")
      .replace(/:$/, "")
      .trim();

    let layout: SlideLayout = "content";
    const layoutMatch = rawTitle.match(/^\[(CONTENT|STATS|COMPARISON|SECTION|QUOTE|OBJECTION|CALLOUT|STATEMENT)\]\s*/i);
    if (layoutMatch) {
      layout = layoutMatch[1].toLowerCase() as SlideLayout;
      rawTitle = rawTitle.substring(layoutMatch[0].length).trim();
    }

    const keepSeparators = layout === "comparison" || layout === "objection";
    const rawBodyLines = lines.slice(1);

    let speakerNotes = "";
    const notesStartIdx = rawBodyLines.findIndex(l => /^(NOTES|SPEAKER NOTES|Emphasize|Anchor on|Talking points):/i.test(l.trim()));
    let contentLines: string[];
    if (notesStartIdx >= 0) {
      contentLines = rawBodyLines.slice(0, notesStartIdx);
      speakerNotes = rawBodyLines.slice(notesStartIdx).map(l => l.trim()).filter(l => l).join("\n");
    } else {
      contentLines = rawBodyLines;
    }

    const bodyLines = contentLines
      .filter(l => (keepSeparators ? l.trim() : (l.trim() && !l.match(/^---+$/))))
      .map(l => keepSeparators && l.match(/^---+$/) ? "---" : cleanLine(l))
      .filter(l => l);

    if (!rawTitle && bodyLines.length === 0) continue;

    const title = rawTitle || "Key Points";

    const noSplit = layout === "comparison" || layout === "quote" || layout === "stats" || layout === "section" || layout === "objection" || layout === "callout" || layout === "statement";
    if (noSplit || bodyLines.length <= MAX_BODY_LINES) {
      slides.push({ title, body: bodyLines.join("\n"), layout, speakerNotes });
    } else {
      let chunkIndex = 0;
      for (let start = 0; start < bodyLines.length; start += MAX_BODY_LINES) {
        const chunk = bodyLines.slice(start, start + MAX_BODY_LINES);
        const slideTitle = chunkIndex === 0 ? title : `${title} (cont.)`;
        slides.push({ title: slideTitle, body: chunk.join("\n"), layout: chunkIndex === 0 ? layout : "content", speakerNotes: chunkIndex === 0 ? speakerNotes : "" });
        chunkIndex++;
      }
    }
  }

  if (slides.length === 0) {
    slides.push({ title: "Demandbase", body: raw.substring(0, 800) });
  }

  return slides.slice(0, 20);
}
