(function () {
  const ELEMENT_NAME = "signa-form";

  if (window.customElements.get(ELEMENT_NAME)) {
    return;
  }

  class SignaFormElement extends HTMLElement {
    connectedCallback() {
      this.render();
      this.onMessage = this.handleMessage.bind(this);
      window.addEventListener("message", this.onMessage);
    }

    disconnectedCallback() {
      window.removeEventListener("message", this.onMessage);
    }

    static get observedAttributes() {
      return ["data-host", "data-src", "data-token", "data-theme", "data-primary-color"];
    }

    attributeChangedCallback(name) {
      if (!this.isConnected) return;
      if (name === "data-theme" || name === "data-primary-color") {
        this.sendAppearance();
      } else {
        this.render();
      }
    }

    sendAppearance() {
      if (!this.iframe?.src) return;
      this.iframe.contentWindow?.postMessage({
        source: "signa:host", type: "appearance",
        appearance: { theme: this.dataset.theme, primaryColor: this.dataset.primaryColor },
      }, new URL(this.iframe.src).origin);
    }

    handleMessage(event) {
      if (!this.iframe?.src || event.source !== this.iframe.contentWindow || event.origin !== new URL(this.iframe.src).origin) {
        return;
      }

      const data = event.data || {};
      if (data.source === "signa" && (data.type === "load" || data.type === "appearance-ready")) this.sendAppearance();

      if (data.source !== "signa") {
        return;
      }

      if (data.type === "resize") {
        const height = Number(data.height);
        if (Number.isFinite(height) && height > 0) this.iframe.style.height = `${Math.max(height, 320)}px`;
        return;
      }

      const eventName = {
        completed: "completed",
        declined: "declined",
        init: "init",
        load: "load",
      }[data.type];

      if (eventName) {
        this.dispatchEvent(
          new CustomEvent(eventName, {
            bubbles: true,
            detail: data.detail,
          }),
        );
      }
    }

    render() {
      const src = this.dataset.src || this.dataset.token || "";

      if (!src) {
        return;
      }

      if (!this.iframe) {
        this.iframe = document.createElement("iframe");
        this.iframe.setAttribute("title", "Signa signing form");
        this.iframe.setAttribute("allow", "clipboard-write; fullscreen");
        this.iframe.style.border = "0";
        this.iframe.style.display = "block";
        this.iframe.style.minHeight = "520px";
        this.iframe.style.width = "100%";
        this.appendChild(this.iframe);
      }

      const nextUrl = this.buildFrameUrl(src);
      if (this.iframe.src !== nextUrl) this.iframe.src = nextUrl;
    }

    buildFrameUrl(src) {
      const url = new URL(src, this.getFrameBaseUrl());

      if (!["http:", "https:"].includes(url.protocol)) throw new Error("Signing URL must use HTTP or HTTPS");
      url.searchParams.set("embed", "true");

      for (const [key, value] of Object.entries(this.dataset)) {
        if (["host", "src"].includes(key) || value === undefined) {
          continue;
        }

        url.searchParams.set(toKebabCase(key), value);
      }

      return url.toString();
    }

    getFrameBaseUrl() {
      return this.dataset.host || window.location.href;
    }
  }

  function toKebabCase(value) {
    return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  }

  window.customElements.define(ELEMENT_NAME, SignaFormElement);
})();
