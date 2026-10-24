import { google } from "googleapis";
import { DRIVE_MAX_BYTES, readDriveStream } from "./drive-download";

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
      return await fn(true);
    }
    throw err;
  }
}

export async function getUncachableGoogleDriveClient(forceRefresh = false) {
  const auth = await getAuth(forceRefresh);
  return google.drive({ version: "v3", auth });
}

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
  if (typeof fileId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(fileId)) throw new Error("Invalid Google Drive file ID.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const requestOptions = { signal: controller.signal, timeout: 30000, retry: false };
  try {
  return await withAuthRetry(async (forceRefresh) => {
    const drive = await getUncachableGoogleDriveClient(forceRefresh);

    const meta = await drive.files.get({ fileId, fields: "name, mimeType, size" }, requestOptions);
    const name = meta.data.name!;
    const mimeType = meta.data.mimeType!;
    if (meta.data.size && Number(meta.data.size) > DRIVE_MAX_BYTES) throw new Error("Google Drive file exceeds the 50 MB size limit.");

    if (mimeType === "application/vnd.google-apps.document") {
      const res = await drive.files.export(
        { fileId, mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
        { ...requestOptions, responseType: "stream" }
      );
      return {
        buffer: await readDriveStream(res.data, controller.signal),
        name: name.endsWith(".docx") ? name : name + ".docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      };
    }

    if (mimeType === "application/vnd.google-apps.presentation") {
      const res = await drive.files.export(
        { fileId, mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
        { ...requestOptions, responseType: "stream" }
      );
      return {
        buffer: await readDriveStream(res.data, controller.signal),
        name: name.endsWith(".pptx") ? name : name + ".pptx",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      };
    }

    const res = await drive.files.get(
      { fileId, alt: "media" },
      { ...requestOptions, responseType: "stream" }
    );
    return {
      buffer: await readDriveStream(res.data, controller.signal),
      name,
      mimeType,
    };
  });
  } catch (error: any) {
    // Do not propagate SDK request objects, credential-bearing URLs, or provider bodies.
    if (controller.signal.aborted) throw new Error("Google Drive download timed out. Try a smaller file or retry.");
    if (error?.message === "Google Drive file exceeds the 50 MB size limit.") throw new Error(error.message);
    const status = Number(error?.response?.status ?? error?.code);
    if (status === 401 || status === 403) throw new Error("Google Drive access failed. Reauthorize Drive or check file permissions.");
    if (status === 429) throw new Error("Google Drive rate limit reached. Retry later.");
    throw new Error("Google Drive download failed. Check the connection, Drive configuration and file permissions, then retry.");
  } finally { clearTimeout(timer); }
}
