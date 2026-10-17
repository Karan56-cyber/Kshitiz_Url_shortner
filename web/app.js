import {
  Alignment,
  Fit,
  Layout,
  Rive,
  RuntimeLoader,
} from "@rive-app/canvas";
import { publicShortUrl } from "./public-short-url.js";

const authView = document.querySelector("#auth-view");
const dashboardView = document.querySelector("#dashboard-view");
const authForm = document.querySelector("#auth-form");
const authModeToggle = document.querySelector("#auth-mode-toggle");
const guestStartButton = document.querySelector("#guest-start");
const authTitle = document.querySelector("#auth-title");
const authIntro = document.querySelector("#auth-intro");
const demoNotice = document.querySelector("#demo-notice");
const dashboardDemoNotice = document.querySelector("#dashboard-demo-notice");
const guestRetention = document.querySelector(".guest-retention");
const authSubmit = document.querySelector("#auth-submit");
const authError = document.querySelector("#auth-error");
const authEmailField = document.querySelector("#auth-email-field");
const authPasswordField = document.querySelector("#auth-password-field");
const authPassword = document.querySelector("#auth-password");
const authPasswordLabel = document.querySelector("#auth-password-label");
const resetConfirmField = document.querySelector("#reset-confirm-field");
const resetPasswordConfirm = document.querySelector("#reset-password-confirm");
const forgotPasswordButton = document.querySelector("#forgot-password");
const passwordRequirement = document.querySelector("#password-requirement");
const workspaceSelect = document.querySelector("#workspace-select");
const workspaceRole = document.querySelector("#workspace-role");
const guestNotice = document.querySelector("#guest-notice");
const linkRows = document.querySelector("#link-rows");
const linkCount = document.querySelector("#link-count");
const ledgerEmpty = document.querySelector("#ledger-empty");
const dashboardMessage = document.querySelector("#dashboard-message");
const createMessage = document.querySelector("#create-message");
const createdLinkResult = document.querySelector("#created-link-result");
const createdShortLink = document.querySelector("#created-short-link");
const copyCreatedLinkButton = document.querySelector("#copy-created-link");
const createdLinkFeedback = document.querySelector("#created-link-feedback");
const createLinkForm = document.querySelector("#create-link-form");
const createLinkSubmit = document.querySelector("#create-link-submit");
const clickTotal = document.querySelector("#click-total");
const chart = document.querySelector("#traffic-chart");
const chartEmpty = document.querySelector("#chart-empty");
const chartAxisLabels = document.querySelector("#chart-axis-labels");
const dataWindow = document.querySelector("#data-window");

let accessToken = sessionStorage.getItem("linkpulseAccessToken") ?? "";
let demoMode = false;
let isGuest = false;
let guestExpiresAt = "";
let currentWorkspaceId = "";
let workspaces = [];
let authMode = "login";
let selectedDays = 30;
let riveInstance = null;
let riveLoadFailed = false;
let dashboardRequestSequence = 0;
let passwordResetToken =
  new URLSearchParams(window.location.hash.slice(1)).get("resetToken") ?? "";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

RuntimeLoader.setWasmUrl("/assets/rive.wasm");

function setMessage(element, message = "", success = false) {
  element.textContent = message;
  element.hidden = message.length === 0;
  element.classList.toggle("is-success", success);
}

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === "register";
  const requestingReset = mode === "reset-request";
  const resettingPassword = mode === "reset";
  const recovering = requestingReset || resettingPassword;
  authTitle.textContent = registering
    ? "Create your workspace."
    : requestingReset
      ? "Find your way back."
      : resettingPassword
        ? "Choose a new password."
        : "Start with a real link.";
  authIntro.textContent = registering
    ? "Register to keep your links and traffic together in a saved account."
    : requestingReset
      ? "Enter your account email and we’ll send a secure reset link."
      : resettingPassword
        ? "Choose a new password to get back to your workspace."
        : "Create a short link and check its traffic without setting up an account.";
  authSubmit.textContent = registering
    ? "Create account"
    : requestingReset
      ? "Send reset link"
      : resettingPassword
        ? "Save new password"
        : "Sign in";
  authModeToggle.hidden = false;
  authModeToggle.textContent = recovering
    ? "Back to sign in"
    : registering
      ? "Already have an account? Sign in"
      : "Create an account";
  authEmailField.hidden = resettingPassword;
  authPasswordField.hidden = requestingReset;
  authPassword.required = !requestingReset;
  document.querySelector("#auth-email").required = !resettingPassword;
  resetConfirmField.hidden = !resettingPassword;
  resetPasswordConfirm.required = resettingPassword;
  forgotPasswordButton.hidden = mode !== "login";
  document.querySelector(".guest-entry").hidden = recovering;
  document.querySelector(".auth-divider").hidden = recovering;
  document.querySelector("#privacy-note").hidden = recovering;
  passwordRequirement.hidden = !registering && !resettingPassword;
  authPasswordLabel.textContent = resettingPassword ? "New password" : "Password";
  authPassword.minLength = registering || resettingPassword ? 12 : 1;
  authPassword.setAttribute(
    "autocomplete",
    registering || resettingPassword ? "new-password" : "current-password",
  );
  authPassword.placeholder = "At least 12 characters";
  if (!resettingPassword) resetPasswordConfirm.value = "";
  setMessage(authError);
}

function showAuth(message = "") {
  dashboardRequestSequence += 1;
  dashboardView.hidden = true;
  authView.hidden = false;
  setMessage(authError, message);
  startLoginAnimation();
}

function showDashboard() {
  stopLoginAnimation();
  authView.hidden = true;
  dashboardView.hidden = false;
}

function startLoginAnimation() {
  if (riveInstance || riveLoadFailed || authView.hidden) return;
  const canvas = document.querySelector("#login-animation");
  const fallback = document.querySelector("#animation-fallback");
  const showAnimationFallback = (error) => {
    console.error(
      "Could not load the LinkPulse login animation.",
      error?.data ?? (error instanceof Error ? error.message : error),
    );
    riveLoadFailed = true;
    riveInstance?.cleanup();
    riveInstance = null;
    canvas.hidden = true;
    fallback.hidden = false;
  };
  try {
    riveInstance = new Rive({
      src: "/assets/login.riv",
      canvas,
      artboard: "Teddy",
      stateMachine: "Login Machine",
      layout: new Layout({
        fit: Fit.Contain,
        alignment: Alignment.Center,
      }),
      autoplay: !reducedMotion.matches,
      onLoad: () => riveInstance?.resizeDrawingSurfaceToCanvas(),
      onLoadError: showAnimationFallback,
    });
    fallback.hidden = true;
  } catch (error) {
    showAnimationFallback(error);
  }
}

function stopLoginAnimation() {
  if (!riveInstance) return;
  riveInstance.cleanup();
  riveInstance = null;
}

reducedMotion.addEventListener("change", (event) => {
  if (!riveInstance) return;
  if (event.matches) riveInstance.pause();
  else riveInstance.play();
});

window.addEventListener("pagehide", stopLoginAnimation);
window.addEventListener("pageshow", () => {
  if (!authView.hidden) startLoginAnimation();
});

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set("Accept", "application/json");
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  let response;
  try {
    const url = path.startsWith("http") ? path : `${(window.__API_URL__ || "").replace(/\/+$/, "")}${path}`;
    response = await fetch(url, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new Error("LinkPulse could not be reached. Check your connection and retry.");
  }
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : null;

  if (!response.ok) {
    if (response.status === 401 && accessToken && !path.startsWith("/auth/")) {
      accessToken = "";
      isGuest = false;
      guestExpiresAt = "";
      sessionStorage.removeItem("linkpulseAccessToken");
      showAuth("Your session expired. Sign in again to continue.");
    }
    const error = new Error(
      typeof body?.message === "string"
        ? body.message
        : "The request could not be completed. Try again.",
    );
    error.status = response.status;
    throw error;
  }
  return body;
}

function selectedWorkspace() {
  return workspaces.find((workspace) => workspace.id === currentWorkspaceId);
}

function updateWorkspaceOptions() {
  dashboardDemoNotice.hidden = !demoMode || isGuest;
  workspaceSelect.replaceChildren();
  for (const workspace of workspaces) {
    const option = document.createElement("option");
    option.value = workspace.id;
    option.textContent = workspace.name;
    workspaceSelect.append(option);
  }
  workspaceSelect.value = currentWorkspaceId;
  workspaceRole.textContent = isGuest
    ? "guest workspace"
    : selectedWorkspace()?.role.toLowerCase() ?? "";
  guestNotice.hidden = !isGuest;
  if (isGuest && guestExpiresAt) {
    if (demoMode) {
      guestNotice.textContent =
        "Demo mode: this workspace, links, and analytics reset when the server restarts.";
    } else {
      const expiry = new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(guestExpiresAt));
      guestNotice.textContent =
        `Guest mode: this workspace, links, and analytics will be deleted on ${expiry}.`;
    }
  }
  document.querySelector("#sign-out").textContent = isGuest
    ? "End guest session"
    : "Sign out";
}

async function loadWorkspaces(preferredWorkspaceId = "") {
  const result = await apiRequest("/workspaces");
  if (!Array.isArray(result)) {
    throw new Error("The workspace list could not be read. Try signing in again.");
  }
  workspaces = result;
  if (workspaces.length === 0) {
    throw new Error("No workspace is available for this account.");
  }
  currentWorkspaceId =
    workspaces.find((workspace) => workspace.id === preferredWorkspaceId)?.id ??
    workspaces.find((workspace) => workspace.id === currentWorkspaceId)?.id ??
    workspaces[0].id;
  updateWorkspaceOptions();
}

function dateRange(days) {
  const to = new Date();
  const from = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
  );
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: from.toISOString(), to: to.toISOString() };
}

function addQuery(path, values) {
  const query = new URLSearchParams(values);
  return `${path}?${query.toString()}`;
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatShortUrl(anchor, value) {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "");
  const lastSlash = path.lastIndexOf("/");
  const originAndPath = makeElement(
    "span",
    "short-link-origin",
    `${url.host}${path.slice(0, lastSlash + 1)}`,
  );
  const alias = makeElement("span", "short-link-alias", path.slice(lastSlash + 1));
  anchor.replaceChildren(originAndPath, alias);
  anchor.href = url.href;
  anchor.title = url.href;
  anchor.setAttribute("aria-label", url.href);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back to the selection-based copy for browsers that deny clipboard access.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  let copied = false;
  const previousFocus = document.activeElement;
  try {
    document.body.append(textarea);
    textarea.select();
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    if (previousFocus instanceof HTMLElement) {
      previousFocus.focus({ preventScroll: true });
    }
  }
  if (!copied) {
    throw new Error("Clipboard access is unavailable. Select the short link to copy it.");
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function renderChart(daily, days) {
  chart.replaceChildren();
  const range = dateRange(days);
  const start = new Date(range.from);
  const end = new Date(range.to);
  const dailyCounts = new Map(
    daily.map((item) => [
      new Date(item.date).toISOString().slice(0, 10),
      Number(item.clicks) || 0,
    ]),
  );
  const points = [];
  for (let index = 0; index < days; index += 1) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    points.push({
      date,
      clicks: dailyCounts.get(date.toISOString().slice(0, 10)) ?? 0,
    });
  }

  const total = points.reduce((sum, point) => sum + point.clicks, 0);
  clickTotal.textContent = formatNumber(total);
  chartEmpty.hidden = total > 0;
  chart.hidden = total === 0;
  chartAxisLabels.hidden = total === 0;
  dataWindow.textContent = `Last ${days} days`;
  if (total === 0) return;

  const width = 720;
  const height = 160;
  const horizontalInset = 12;
  const verticalInset = 12;
  const max = Math.max(1, ...points.map((point) => point.clicks));
  const plotted = points.map((point, index) => ({
    x: horizontalInset + (index / Math.max(1, points.length - 1)) * (width - 2 * horizontalInset),
    y: height - verticalInset -
      (point.clicks / max) * (height - 2 * verticalInset),
  }));

  for (let index = 0; index < 3; index += 1) {
    const y = verticalInset + index * ((height - 2 * verticalInset) / 2);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", "0");
    line.setAttribute("x2", String(width));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("class", "chart-grid-line");
    chart.append(line);
  }

  const linePath = plotted
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
  const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
  area.setAttribute(
    "d",
    `${linePath} L${plotted.at(-1).x},${height - verticalInset} L${plotted[0].x},${height - verticalInset} Z`,
  );
  area.setAttribute("class", "chart-area");
  chart.append(area);

  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("d", linePath);
  line.setAttribute("pathLength", "1");
  line.setAttribute("class", "chart-line");
  chart.append(line);

  const peakIndex = points.reduce(
    (peak, point, index) =>
      point.clicks > points[peak].clicks ? index : peak,
    0,
  );
  for (const index of new Set([peakIndex, points.length - 1])) {
    const point = plotted[index];
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(point.x));
    circle.setAttribute("cy", String(point.y));
    circle.setAttribute("r", index === peakIndex ? "5" : "4");
    circle.setAttribute("class", "chart-point");
    chart.append(circle);
  }

  const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
  title.textContent = `${formatNumber(total)} recorded clicks over the last ${days} days`;
  chart.prepend(title);
  const labelFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  chartAxisLabels.children[0].textContent = labelFormatter.format(start);
  chartAxisLabels.children[1].textContent = labelFormatter.format(end);
}

function createTableCell(className, content) {
  const cell = document.createElement("td");
  if (className) cell.className = className;
  if (content) cell.append(content);
  return cell;
}

function renderLinkRow(link, clickCounts) {
  const row = document.createElement("tr");
  const shortCell = createTableCell("short-link-cell");
  const shortUrl = publicShortUrl(link.alias, window.location);
  if (shortUrl) {
    const anchor = makeElement("a", "short-link-display");
    formatShortUrl(anchor, shortUrl);
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    shortCell.append(anchor);
  } else {
    shortCell.textContent = link.alias;
  }

  const destination = createTableCell(
    "destination-cell",
    makeElement("span", "", link.destinationUrl),
  );
  destination.title = link.destinationUrl;

  const status = makeElement(
    "span",
    `status-stamp${link.status === "DISABLED" ? " is-disabled" : ""}`,
    link.status === "ACTIVE" ? "Active" : "Disabled",
  );
  const statusCell = createTableCell("", status);
  const visitsCell = createTableCell(
    "visit-cell",
    makeElement("span", "", formatNumber(clickCounts.get(link.id) ?? 0)),
  );
  const actions = makeElement("div", "row-actions");
  const copyButton = makeElement("button", "row-action", "Copy link");
  copyButton.type = "button";
  copyButton.disabled = !shortUrl;
  copyButton.addEventListener("click", async () => {
    if (!shortUrl) return;
    copyButton.disabled = true;
    try {
      await copyText(shortUrl);
      setMessage(dashboardMessage, "Short link copied.", true);
    } catch {
      setMessage(
        dashboardMessage,
        "Clipboard access is unavailable. Select the short link to copy it.",
      );
    } finally {
      copyButton.disabled = false;
    }
  });
  actions.append(copyButton);

  if (link.status === "ACTIVE") {
    const disableButton = makeElement("button", "row-action", "Disable");
    disableButton.type = "button";
    disableButton.addEventListener("click", async () => {
      disableButton.disabled = true;
      setMessage(dashboardMessage);
      try {
        await apiRequest(
          `/workspaces/${encodeURIComponent(currentWorkspaceId)}/links/${encodeURIComponent(link.id)}/disable`,
          { method: "POST" },
        );
        setMessage(dashboardMessage, "Link disabled. Its analytics remain available.", true);
        await loadDashboard();
      } catch (error) {
        setMessage(dashboardMessage, error.message);
        disableButton.disabled = false;
      }
    });
    actions.append(disableButton);
  }

  row.append(
    shortCell,
    destination,
    statusCell,
    visitsCell,
    createTableCell("", actions),
  );
  return row;
}

async function loadDashboard() {
  if (!currentWorkspaceId) return;
  const requestSequence = ++dashboardRequestSequence;
  const workspaceId = currentWorkspaceId;
  const days = selectedDays;
  setMessage(dashboardMessage);
  linkCount.textContent = "Loading workspace links…";
  const range = dateRange(days);
  const prefix = `/workspaces/${encodeURIComponent(workspaceId)}/analytics`;
  let responses;
  try {
    responses = await Promise.all([
      apiRequest(
        `/workspaces/${encodeURIComponent(workspaceId)}/links?limit=50`,
      ),
      apiRequest(
        addQuery(`${prefix}/overview`, {
          from: range.from,
          to: range.to,
          limit: "10",
        }),
      ),
      apiRequest(
        addQuery(`${prefix}/links`, {
          from: range.from,
          to: range.to,
          limit: "50",
          offset: "0",
        }),
      ),
    ]);
  } catch (error) {
    if (
      requestSequence !== dashboardRequestSequence ||
      workspaceId !== currentWorkspaceId ||
      days !== selectedDays
    ) {
      return;
    }
    linkCount.textContent = "Workspace links could not be loaded.";
    throw error;
  }
  const [links, overview, analytics] = responses;
  if (
    !Array.isArray(links) ||
    !Array.isArray(overview.daily) ||
    !Array.isArray(analytics.links)
  ) {
    linkCount.textContent = "Workspace data could not be read.";
    throw new Error("Workspace data could not be read. Refresh to try again.");
  }
  if (
    requestSequence !== dashboardRequestSequence ||
    workspaceId !== currentWorkspaceId ||
    days !== selectedDays
  ) {
    return;
  }
  const clickCounts = new Map(
    analytics.links.map((link) => [link.linkId, Number(link.clicks) || 0]),
  );
  linkRows.replaceChildren(
    ...links.map((link) => renderLinkRow(link, clickCounts)),
  );
  ledgerEmpty.hidden = links.length > 0;
  linkCount.textContent = links.length === 0
    ? "No links in this workspace yet."
    : `Showing ${links.length} of ${formatNumber(analytics.totalLinks)} links`;
  renderChart(overview.daily, days);
}

authModeToggle.addEventListener("click", () => {
  if (authMode === "reset") {
    passwordResetToken = "";
    window.history.replaceState(null, "", window.location.pathname);
  }
  setAuthMode(authMode === "login" ? "register" : "login");
  document.querySelector("#auth-email").focus();
});

forgotPasswordButton.addEventListener("click", () => {
  setAuthMode("reset-request");
  document.querySelector("#auth-email").focus();
});

document.querySelectorAll(".password-visibility").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.passwordTarget);
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    button.textContent = visible ? "Hide" : "Show";
    button.setAttribute("aria-pressed", String(visible));
  });
});

authPassword.addEventListener("input", () => {
  const complete = authPassword.value.length >= 12;
  passwordRequirement.classList.toggle("is-complete", complete);
  passwordRequirement.textContent = complete
    ? "Password length looks good."
    : "Use at least 12 characters.";
});

guestStartButton.addEventListener("click", async () => {
  guestStartButton.disabled = true;
  guestStartButton.textContent = "Starting guest workspace…";
  setMessage(authError);
  try {
    const guestSession = await apiRequest("/auth/guest", { method: "POST" });
    accessToken = guestSession.accessToken;
    isGuest = true;
    guestExpiresAt = guestSession.user.guestExpiresAt;
    sessionStorage.setItem("linkpulseAccessToken", accessToken);
    await loadWorkspaces(guestSession.workspace.id);
    showDashboard();
    try {
      await loadDashboard();
    } catch (error) {
      setMessage(dashboardMessage, error.message);
    }
  } catch (error) {
    setMessage(authError, error.message);
  } finally {
    guestStartButton.disabled = false;
    guestStartButton.textContent = "Continue as guest";
  }
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!authForm.reportValidity()) return;
  authSubmit.disabled = true;
  const submitLabel = authSubmit.textContent;
  authSubmit.textContent = "Working…";
  authSubmit.setAttribute("aria-busy", "true");
  setMessage(authError);
  const form = new FormData(authForm);
  const payload = {
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("password") ?? ""),
  };
  try {
    if (authMode === "reset-request") {
      await apiRequest("/auth/password-reset/request", {
        method: "POST",
        body: { email: payload.email },
      });
      setMessage(
        authError,
        "If an account exists for that email, password reset instructions have been sent.",
        true,
      );
      return;
    }
    if (authMode === "reset") {
      if (!passwordResetToken) {
        throw new Error("This reset link is invalid. Request a new one.");
      }
      if (payload.password !== resetPasswordConfirm.value) {
        throw new Error("The passwords do not match. Check both fields and retry.");
      }
      await apiRequest("/auth/password-reset/confirm", {
        method: "POST",
        body: { token: passwordResetToken, password: payload.password },
      });
      passwordResetToken = "";
      accessToken = "";
      sessionStorage.removeItem("linkpulseAccessToken");
      window.history.replaceState(null, "", window.location.pathname);
      authForm.reset();
      setAuthMode("login");
      setMessage(authError, "Password updated. Sign in with your new password.", true);
      document.querySelector("#auth-email").focus();
      return;
    }
    const account = await apiRequest(
      authMode === "register" ? "/auth/register" : "/auth/login",
      { method: "POST", body: payload },
    );
    accessToken = account.accessToken;
    isGuest = false;
    guestExpiresAt = "";
    sessionStorage.setItem("linkpulseAccessToken", accessToken);
    authForm.reset();
    await loadWorkspaces(account.workspace?.id ?? "");
    showDashboard();
    try {
      await loadDashboard();
    } catch (error) {
      setMessage(dashboardMessage, error.message);
    }
  } catch (error) {
    setMessage(
      authError,
      error.status === 401 && authMode === "login"
        ? "That email and password did not match. Try again."
        : error.message,
    );
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = submitLabel;
    authSubmit.removeAttribute("aria-busy");
  }
});

workspaceSelect.addEventListener("change", async () => {
  currentWorkspaceId = workspaceSelect.value;
  workspaceRole.textContent = selectedWorkspace()?.role.toLowerCase() ?? "";
  try {
    await loadDashboard();
  } catch (error) {
    setMessage(dashboardMessage, error.message);
  }
});

document.querySelectorAll(".range-picker button").forEach((button) => {
  button.addEventListener("click", async () => {
    selectedDays = Number(button.dataset.days);
    document.querySelectorAll(".range-picker button").forEach((item) => {
      item.setAttribute("aria-pressed", String(item === button));
    });
    try {
      await loadDashboard();
    } catch (error) {
      setMessage(dashboardMessage, error.message);
    }
  });
});

createLinkForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!createLinkForm.reportValidity()) return;
  createLinkSubmit.disabled = true;
  workspaceSelect.disabled = true;
  setMessage(createMessage);
  createdLinkResult.hidden = true;
  createdLinkFeedback.textContent = "";

  const workspaceId = currentWorkspaceId;
  const payload = {
    destinationUrl: document.querySelector("#destination-url").value.trim(),
  };
  const alias = document.querySelector("#link-alias").value.trim();
  const expiresAt = document.querySelector("#link-expiry").value;
  const maxClicks = document.querySelector("#link-max-clicks").value;
  if (alias) payload.alias = alias;
  if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString();
  if (maxClicks) payload.maxClicks = Number(maxClicks);

  try {
    const link = await apiRequest(
      `/workspaces/${encodeURIComponent(workspaceId)}/links`,
      { method: "POST", body: payload },
    );
    createLinkForm.reset();
    document.querySelector("#link-expiry").value = "";
    document.querySelector("#link-max-clicks").value = "";
    const shortUrl = publicShortUrl(link.alias, window.location);
    if (!shortUrl) throw new Error("The server returned an invalid short link.");
    formatShortUrl(createdShortLink, shortUrl);
    copyCreatedLinkButton.dataset.copyUrl = shortUrl;
    createdLinkResult.hidden = false;
    setMessage(createMessage, "Your short link is ready.", true);
    await loadDashboard();
  } catch (error) {
    setMessage(createMessage, error.message);
  } finally {
    createLinkSubmit.disabled = false;
    workspaceSelect.disabled = false;
  }
});

copyCreatedLinkButton.addEventListener("click", async () => {
  copyCreatedLinkButton.disabled = true;
  createdLinkFeedback.textContent = "";
  try {
    await copyText(copyCreatedLinkButton.dataset.copyUrl ?? createdShortLink.href);
    createdLinkFeedback.textContent = "Copied";
  } catch (error) {
    createdLinkFeedback.textContent = error.message;
  } finally {
    copyCreatedLinkButton.disabled = false;
  }
});

document.querySelector("#refresh-links").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await loadDashboard();
  } catch (error) {
    setMessage(dashboardMessage, error.message);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#sign-out").addEventListener("click", () => {
  accessToken = "";
  isGuest = false;
  guestExpiresAt = "";
  currentWorkspaceId = "";
  workspaces = [];
  sessionStorage.removeItem("linkpulseAccessToken");
  authForm.reset();
  setAuthMode("login");
  showAuth();
});

document.querySelectorAll(".sidebar-nav .nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".sidebar-nav .nav-link").forEach((item) => {
      const current = item === link;
      item.classList.toggle("is-current", current);
      if (current) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
  });
});

async function initialize() {
  if (passwordResetToken) setAuthMode("reset");
  try {
    const status = await apiRequest("/health/live");
    demoMode = status.demoMode === true;
    demoNotice.hidden = !demoMode;
    dashboardDemoNotice.hidden = !demoMode;
    if (demoMode) {
      guestRetention.textContent =
        "Demo workspaces, links, and analytics reset when the server restarts.";
    }
  } catch {
    setMessage(
      authError,
      "The LinkPulse API is not reachable. Start it with `npm run dev` and refresh this page.",
    );
  }
  if (passwordResetToken || !accessToken) {
    startLoginAnimation();
    return;
  }
  try {
    const profile = await apiRequest("/auth/me");
    isGuest = profile.isGuest === true;
    guestExpiresAt = isGuest ? profile.guestExpiresAt ?? "" : "";
    await loadWorkspaces();
    showDashboard();
    try {
      await loadDashboard();
    } catch (error) {
      setMessage(dashboardMessage, error.message);
    }
  } catch (error) {
    if (error.status === 401) {
      accessToken = "";
      isGuest = false;
      guestExpiresAt = "";
      sessionStorage.removeItem("linkpulseAccessToken");
      showAuth("Your session ended. Sign in to see your workspace.");
    } else {
      showAuth(error.message);
    }
  }
}

void initialize();
