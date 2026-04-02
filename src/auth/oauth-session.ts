import { randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import type { OAuthConfig } from "../config.js";

interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope?: string;
  requestedScopes?: string[];
  expiresIn: number;
  acquiredAt: number;
}

interface TokenEndpointResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  scope?: string;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createCodeVerifier(): string {
  return toBase64Url(randomBytes(64));
}

function createCodeChallenge(verifier: string): string {
  return toBase64Url(createHash("sha256").update(verifier).digest());
}

function createState(): string {
  return toBase64Url(randomBytes(24));
}

async function openBrowser(url: string): Promise<boolean> {
  try {
    if (process.platform === "darwin") {
      const child = spawn("open", [url], { detached: true, stdio: "ignore" });
      child.unref();
      return true;
    }

    if (process.platform === "win32") {
      const child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
      child.unref();
      return true;
    }

    const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function getCallbackPort(url: URL): number {
  if (url.port) {
    return Number(url.port);
  }
  return url.protocol === "https:" ? 443 : 80;
}

export class OAuthSession {
  private readonly config: OAuthConfig;
  private tokens?: StoredTokens;
  private authInFlight?: Promise<void>;

  public constructor(config: OAuthConfig) {
    this.config = config;
  }

  public async getAccessToken(): Promise<string> {
    await this.ensureValidTokens();
    if (!this.tokens?.accessToken) {
      throw new Error("No OAuth access token available.");
    }
    return this.tokens.accessToken;
  }

  public async forceRefresh(): Promise<void> {
    await this.ensureValidTokens(true);
  }

  private async ensureValidTokens(forceRefresh = false): Promise<void> {
    if (this.authInFlight) {
      await this.authInFlight;
      return;
    }

    this.authInFlight = this.ensureValidTokensInternal(forceRefresh).finally(() => {
      this.authInFlight = undefined;
    });
    await this.authInFlight;
  }

  private async ensureValidTokensInternal(forceRefresh: boolean): Promise<void> {
    if (!this.tokens) {
      this.tokens = await this.loadStoredTokens();
    }

    const missingScopes = this.tokens ? this.getMissingScopes(this.tokens) : [];
    if (missingScopes.length > 0) {
      console.log(
        `Cached OAuth token missing scopes: ${missingScopes.join(", ")}. Re-authenticating with requested scopes...`,
      );
      this.tokens = undefined;
    }

    if (this.tokens && !forceRefresh && !this.isExpiringSoon(this.tokens)) {
      return;
    }

    if (this.tokens?.refreshToken) {
      try {
        this.tokens = await this.refreshTokens(this.tokens.refreshToken);
        await this.persistTokens(this.tokens);
        return;
      } catch {
        // Fall through to interactive auth flow.
      }
    }

    this.tokens = await this.runAuthorizationCodeFlow();
    await this.persistTokens(this.tokens);
  }

  private getMissingScopes(tokens: StoredTokens): string[] {
    if (!tokens.scope && !tokens.requestedScopes?.length) {
      // Legacy token records may not include any scope metadata.
      // Re-auth to ensure the current configured scopes are actually granted.
      return [...this.config.scopes];
    }
    const granted = new Set(
      tokens.scope ? tokens.scope.split(/\s+/).filter(Boolean) : tokens.requestedScopes?.filter(Boolean),
    );
    return this.config.scopes.filter((scope) => !granted.has(scope));
  }

  private isExpiringSoon(tokens: StoredTokens): boolean {
    const expiresAt = tokens.acquiredAt + tokens.expiresIn * 1000;
    return Date.now() >= expiresAt - 60_000;
  }

  private async loadStoredTokens(): Promise<StoredTokens | undefined> {
    try {
      const raw = await readFile(this.config.tokenStorePath, "utf8");
      const parsed = JSON.parse(raw) as StoredTokens;
      if (!parsed.accessToken || !parsed.expiresIn || !parsed.acquiredAt) {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }

  private async persistTokens(tokens: StoredTokens): Promise<void> {
    await mkdir(dirname(this.config.tokenStorePath), { recursive: true });
    await writeFile(this.config.tokenStorePath, JSON.stringify(tokens, null, 2), "utf8");
  }

  private async runAuthorizationCodeFlow(): Promise<StoredTokens> {
    const verifier = createCodeVerifier();
    const challenge = createCodeChallenge(verifier);
    const state = createState();
    const redirectUrl = new URL(this.config.redirectUri);

    if (redirectUrl.protocol !== "http:" && redirectUrl.protocol !== "https:") {
      throw new Error("X_REDIRECT_URI must use http:// or https://");
    }

    const authUrl = new URL(this.config.authorizeUrl);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", this.config.clientId);
    authUrl.searchParams.set("redirect_uri", this.config.redirectUri);
    authUrl.searchParams.set("scope", this.config.scopes.join(" "));
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    const callbackPromise = this.waitForCallbackCode(redirectUrl, state);
    const opened = await openBrowser(authUrl.toString());

    if (!opened) {
      console.log("Open this URL in your browser to authorize the app:");
    }
    console.log(authUrl.toString());

    const authorizationCode = await callbackPromise;

    const tokenResponse = await this.requestToken(
      new URLSearchParams({
        code: authorizationCode,
        grant_type: "authorization_code",
        redirect_uri: this.config.redirectUri,
        code_verifier: verifier,
        client_id: this.config.clientId,
      }),
    );

    return {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      tokenType: tokenResponse.token_type,
      scope: tokenResponse.scope,
      requestedScopes: [...this.config.scopes],
      expiresIn: tokenResponse.expires_in,
      acquiredAt: Date.now(),
    };
  }

  private async refreshTokens(refreshToken: string): Promise<StoredTokens> {
    const tokenResponse = await this.requestToken(
      new URLSearchParams({
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        client_id: this.config.clientId,
      }),
    );

    return {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token ?? refreshToken,
      tokenType: tokenResponse.token_type,
      scope: tokenResponse.scope,
      requestedScopes: [...this.config.scopes],
      expiresIn: tokenResponse.expires_in,
      acquiredAt: Date.now(),
    };
  }

  private async requestToken(params: URLSearchParams): Promise<TokenEndpointResponse> {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };

    if (this.config.clientSecret) {
      const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString("base64");
      headers.Authorization = `Basic ${basic}`;
    }

    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers,
      body: params.toString(),
    });

    const payload = (await response.json()) as TokenEndpointResponse;
    if (!response.ok || payload.error) {
      const detail = payload.error_description || payload.error || `status ${response.status}`;
      throw new Error(`OAuth token request failed: ${detail}`);
    }

    if (!payload.access_token || !payload.expires_in || !payload.token_type) {
      throw new Error("OAuth token response was missing required fields.");
    }

    return payload;
  }

  private async waitForCallbackCode(redirectUrl: URL, expectedState: string): Promise<string> {
    const timeoutMs = 5 * 60 * 1000;

    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        try {
          const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);
          if (requestUrl.pathname !== redirectUrl.pathname) {
            res.statusCode = 404;
            res.end("Not found");
            return;
          }

          const error = requestUrl.searchParams.get("error");
          if (error) {
            const description = requestUrl.searchParams.get("error_description") || "authorization failed";
            res.statusCode = 400;
            res.end(`Authorization failed: ${description}`);
            clearTimeout(timer);
            server.close();
            reject(new Error(`OAuth authorization failed: ${description}`));
            return;
          }

          const code = requestUrl.searchParams.get("code");
          const state = requestUrl.searchParams.get("state");
          if (!code || !state || state !== expectedState) {
            res.statusCode = 400;
            res.end("Invalid callback parameters.");
            return;
          }

          res.statusCode = 200;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Authentication complete. You can close this tab and return to the terminal.");

          clearTimeout(timer);
          server.close();
          resolve(code);
        } catch (error) {
          clearTimeout(timer);
          server.close();
          reject(error);
        }
      });

      server.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      const timer = setTimeout(() => {
        server.close();
        reject(new Error("Timed out waiting for OAuth callback."));
      }, timeoutMs);

      server.listen(getCallbackPort(redirectUrl), redirectUrl.hostname);
    });
  }
}
