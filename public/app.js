const { createApp } = Vue;

Prism.manual = true;

createApp({
  data() {
    return {
      // ==================== Authentication ====================
      token: localStorage.getItem("token"),
      showLogin: false,
      loginEmail: "",
      loginPassword: "",
      isLoggingIn: false,

      // ==================== Snippet Data ====================
      title: "",
      html: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>Bin Code</title>
  </head>
<body>

</body>
</html>
      `,
      css: "",
      js: "",

      // ==================== Share Modal ====================
      showShareModal: false,
      shareUrl: "",
      currentShareId: null,
      isSaving: false,

      // ==================== Editor State ====================
      activeTab: "html",
      tabs: [
        {
          id: "html",
          label: "HTML",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#E65100" d="m4 4 2 22 10 2 10-2 2-22Zm19.72 7H11.28l.29 3h11.86l-.802 9.335L15.99 25l-6.635-1.646L8.93 19h3.02l.19 2 3.86.77 3.84-.77.29-4H8.84L8 8h16Z"/></svg>',
          language: "markup",
        },
        {
          id: "css",
          label: "CSS",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path fill="#42a5f5" d="m29.18 4-3.57 18.36-.33 1.64-4.74 1.57-3.28 1.09L13.21 28 2.87 24.05 4.05 18h4.2l-.44 2.85 6.34 2.42.78-.26 6.52-2.16.17-.83.79-4.02H4.44l.74-3.76.05-.24h17.96l.78-4H6l.78-4z"/></svg>',
          language: "css",
        },
        {
          id: "js",
          label: "JavaScript",
          icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="#ffca28" d="M2 2h12v12H2zm3.153 10.027c.267.567.794 1.033 1.694 1.033 1 0 1.686-.533 1.686-1.7V7.507H7.4v3.827c0 .573-.233.72-.6.72-.387 0-.547-.267-.727-.58zm3.987-.12c.333.653 1.007 1.153 2.06 1.153 1.067 0 1.867-.553 1.867-1.573 0-.94-.54-1.36-1.5-1.773l-.28-.12c-.487-.207-.694-.347-.694-.68 0-.274.207-.487.54-.487.32 0 .534.14.727.487l.873-.58c-.366-.64-.886-.887-1.6-.887-1.006 0-1.653.64-1.653 1.487 0 .92.54 1.353 1.353 1.7l.28.12c.52.226.827.366.827.753 0 .32-.3.553-.767.553-.553 0-.873-.286-1.113-.686z"/></svg>',
          language: "javascript",
        },
      ],
      highlightedCode: {
        html: "",
        css: "",
        js: "",
      },

      // ==================== View State ====================
      showEditor: true,
      showPreview: true,
      showConsole: true,
      isExecutionPaused: false,

      // ==================== Panel Resize State ====================
      isDragging: false,
      startX: null,
      startWidth: null,
      containerWidth: null,
      editorWidth: "50%",
      minWidth: 250,
      maxWidth: null,

      // ==================== UI State ====================
      updateTimer: null,
      toast: {
        show: false,
        message: "",
        type: "success", // success, error, info
      },

      // ==================== Icons ====================
      icons: {
        visible: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#5f6368"><path d="M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200Zm0-300Zm0 220q113 0 207.5-59.5T832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280Z"/></svg>`,
        hidden: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#5f6368"><path d="m644-428-58-58q9-47-27-88t-93-32l-58-58q17-8 34.5-12t37.5-4q75 0 127.5 52.5T660-500q0 20-4 37.5T644-428Zm128 126-58-56q38-29 67.5-63.5T832-500q-50-101-143.5-160.5T480-720q-29 0-57 4t-55 12l-62-62q41-17 84-25.5t90-8.5q151 0 269 83.5T920-500q-23 59-60.5 109.5T772-302Zm20 246L624-222q-35 11-70.5 16.5T480-200q-151 0-269-83.5T40-500q21-53 53-98.5t73-81.5L56-792l56-56 736 736-56 56ZM222-624q-29 26-53 57t-41 67q50 101 143.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z"/></svg>`,
        console: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#5f6368"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H160v400Zm140-40-56-56 103-104-104-104 57-56 160 160-160 160Zm180 0v-80h240v80H480Z"/></svg>`,
        console_hidden: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 20C3.45 20 2.97917 19.8042 2.5875 19.4125C2.19583 19.0208 2 18.55 2 18V6C2 5.45 2.19583 4.97917 2.5875 4.5875C2.97917 4.19583 3.45 4 4 4H20C20.55 4 21.0208 4.19583 21.4125 4.5875C21.8042 4.97917 22 5.45 22 6V18C22 18.55 21.8042 19.0208 21.4125 19.4125C21.0208 19.8042 20.55 20 20 20H4ZM4 18H20V8H4V18ZM7.5 17L6.1 15.6L8.675 13L6.075 10.4L7.5 9L11.5 13L7.5 17ZM12 17V15H18V17H12Z" fill="#5F6368"/><rect x="3.43359" y="2" width="26.3532" height="2" transform="rotate(45.8073 3.43359 2)" fill="#5F6368"/></svg>`,
        play: `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path fill="currentColor" d="M320-200v-560l440 280-440 280Zm80-280Zm0 134 210-134-210-134v268Z"/></svg>`,
        pause: `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path fill="currentColor" d="M520-200v-560h240v560H520Zm-320 0v-560h240v560H200Zm400-80h80v-400h-80v400Zm-320 0h80v-400h-80v400Zm320-400Zm-320 0Z"/></svg>`,
      },
    };
  },

  computed: {
    displayCode() {
      return {
        html: this.highlightedCode.html || this.html,
        css: this.highlightedCode.css || this.css,
        js: this.highlightedCode.js || this.js,
      };
    },
    currentCode: {
      get() {
        return this[this.activeTab];
      },
      set(value) {
        this[this.activeTab] = value;
        this.highlightCode(value, this.activeTab);
      },
    },

    previewWidth() {
      if (
        typeof this.editorWidth === "string" &&
        this.editorWidth.endsWith("%")
      ) {
        return 100 - parseInt(this.editorWidth) + "%";
      }
      return `calc(100% - ${this.editorWidth}px)`;
    },

    currentLanguage() {
      const tab = this.tabs.find((t) => t.id === this.activeTab);
      return tab ? tab.language : "markup";
    },
  },

  watch: {
    html: {
      handler() {
        this.schedulePreviewUpdate();
      },
    },
    css: {
      handler() {
        this.schedulePreviewUpdate();
      },
    },
    js: {
      handler() {
        this.schedulePreviewUpdate();
      },
    },
  },

  created() {
    // Consistent debounce timing for preview updates
    this.updatePreviewDebounced = this.debounce(this.updatePreview, 500);

    // Load shared snippet if share parameter exists
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get("share");
    if (shareId) {
      this.loadSharedSnippet(shareId);
    }
  },

  mounted() {
    const textarea = document.querySelector('.editor-content textarea');
    if (textarea) {
      textarea.addEventListener('paste', this.handlePaste);
    }

    this.loadPrismTheme();
    this.initThemeListener();

    this.initializeLayout();
    document.addEventListener("keydown", this.handleKeyboardShortcuts);

    // initialize syntax highlighting
    this.highlightCode(this.html, "html");
    this.highlightCode(this.css, "css");
    this.highlightCode(this.js, "js");

    // ensure iframe isloaded before updating the preview
    const preview = document.getElementById("preview-frame");
    if (preview) {
      preview.onload = () => {
        this.updatePreview();
      };
    }
  },
  beforeUnmount() {
    const textarea = document.querySelector('.editor-content textarea');
    if (textarea) {
      textarea.removeEventListener('paste', this.handlePaste);
    }
  },

  methods: {
    // ==================== Toast Notifications ====================
    showToast(message, type = "success") {
      this.toast.message = message;
      this.toast.type = type;
      this.toast.show = true;

      setTimeout(() => {
        this.toast.show = false;
      }, 3000);
    },

    // ==================== Paste and Scroll Handling ====================
    handlePaste(event) {
      const textarea = event.target;

      // Scroll to cursor position after paste
      requestAnimationFrame(() => {
        this.scrollToCursor(textarea);
      });
    },

    scrollToCursor(textarea) {
      const cursorPosition = textarea.selectionStart;
      const lineHeight = parseInt(getComputedStyle(textarea).lineHeight, 10);
      const lines = textarea.value.substr(0, cursorPosition).split('\n').length;
      const scrollTop = (lines - 1) * lineHeight;

      textarea.scrollTop = scrollTop;

      const pre = textarea.nextElementSibling;
      if (pre) {
        pre.scrollTop = scrollTop;
      }
    },

    // ==================== Theme Management ====================
    loadPrismTheme() {
      const existingTheme = document.querySelector("link[data-prism-theme]");
      if (existingTheme) {
        existingTheme.remove();
      }

      const isDarkMode = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;

      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.setAttribute("data-prism-theme", "");

      if (isDarkMode) {
        link.href = "./libraries/prism/theme/prism-vsc-dark-plus.min.css";
      } else {
        link.href = "./libraries/prism/theme/prism.min.css";
      }

      document.head.appendChild(link);
      this.rehighlightCode();
    },

    rehighlightCode() {
      this.highlightCode(this.html, "html");
      this.highlightCode(this.css, "css");
      this.highlightCode(this.js, "js");
    },
    initThemeListener() {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .addEventListener("change", () => {
          this.loadPrismTheme();
        });
    },
    handleScroll(event) {
      const textarea = event.target;
      const pre = textarea.nextElementSibling;
      if (pre) {
        pre.style.width = `${textarea.offsetWidth}px`;
        pre.style.height = `${textarea.offsetHeight}px`;
        
        pre.scrollTop = textarea.scrollTop;
        pre.scrollLeft = textarea.scrollLeft;
      }
    },
    toggleConsole() {
      this.showConsole = !this.showConsole;
      this.updatePreview();
    },
    // ==================== Preview Management ====================
    schedulePreviewUpdate() {
      if (this.updateTimer) {
        clearTimeout(this.updateTimer);
      }

      if (!this.isExecutionPaused) {
        this.updateTimer = setTimeout(() => {
          this.updatePreview();
        }, 500);
      }
    },

    // ==================== View Toggles ====================
    toggleExecution() {
      this.isExecutionPaused = !this.isExecutionPaused;
      if (!this.isExecutionPaused) {
        this.updatePreview();
      }
    },

    toggleEditor() {
      this.showEditor = !this.showEditor;
    },

    togglePreview() {
      this.showPreview = !this.showPreview;
      if (!this.showPreview) {
        this.editorWidth = "100%";
      } else {
        this.editorWidth = "50%";
      }
    },
    // ==================== Syntax Highlighting ====================
    highlightCode(code, tab) {
      const languageMap = {
        html: "markup",
        css: "css",
        js: "javascript",
      };

      const language = languageMap[tab];
      if (!language) return;

      // Run highlighting in requestAnimationFrame to avoid blocking the main thread
      requestAnimationFrame(() => {
        try {
          this.highlightedCode[tab] = Prism.highlight(
            code || "",
            Prism.languages[language],
            language
          );
        } catch (error) {
          console.error("Highlighting error:", error);
          this.highlightedCode[tab] = code || "";
        }
      });
    },

    // ==================== Editor Interaction ====================
    handleKeydown(event) {
      if (event.key === "Tab") {
        event.preventDefault();

        const textarea = event.target;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const spaces = "  ";

        const value = this.currentCode;
        const beforeCursor = value.substring(0, start);
        const afterCursor = value.substring(end);

        if (event.shiftKey) {
          // TODO: Shift + Tab undo 2 space
        } else {
          // Handle Tab (indent)
          this.currentCode = beforeCursor + spaces + afterCursor;

          this.$nextTick(() => {
            textarea.selectionStart = textarea.selectionEnd =
              start + spaces.length;
          });
        }
      }
    },
    handleInput(event) {
      const value = event.target.value;
      this[this.activeTab] = value;
      this.highlightCode(value, this.activeTab);
    },

    debounce(fn, delay) {
      let timeoutId;
      return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
      };
    },

    // ==================== Keyboard Shortcuts ====================
    handleKeyboardShortcuts(e) {
      // Ctrl/Cmd + number for tab switching
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= this.tabs.length) {
          this.activeTab = this.tabs[num - 1].id;
          e.preventDefault();
        }
      }

      // Ctrl/Cmd + S for save
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        this.saveSnippet();
      }
    },

    // ==================== Panel Layout ====================
    initializeLayout() {
      const container = document.querySelector(".editor-container");
      this.containerWidth = container.offsetWidth;
      this.maxWidth = this.containerWidth - this.minWidth;

      this.updateLayout();
    },

    updateLayout() {
      const editorGroup = document.querySelector(".editor-group");
      const preview = document.querySelector(".preview");

      if (editorGroup && preview) {
        editorGroup.style.width = this.editorWidth;
        preview.style.width = this.previewWidth;
      }
    },

    // ==================== Panel Resize ====================

    startResize(event) {
      event.preventDefault();
      this.isDragging = true;

      // Get clientX from either mouse or touch event
      this.startX = event.clientX || (event.touches && event.touches[0].clientX);

      const editorGroup = document.querySelector(".editor-group");
      this.startWidth = editorGroup.offsetWidth;

      this.toggleIframe("none")

      document.body.classList.add('resizing');

      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('touchmove', this.onTouchMove, { passive: false });
      document.addEventListener('mouseup', this.onMouseUp);
      document.addEventListener('touchend', this.onTouchEnd);
    },

    onMouseMove(event) {
      if (!this.isDragging) return;
      this.processMove(event.clientX);
    },

    onTouchMove(event) {
      if (!this.isDragging) return;

      // Prevents scrolling during resize on touch devices
      event.preventDefault();

      if (event.touches && event.touches[0]) {
        this.processMove(event.touches[0].clientX);
      }
    },

    processMove(clientX) {
      const deltaX = clientX - this.startX;
      this.editorWidth = `${this.startWidth + deltaX}px`;
      this.updateLayout();
    },

    onMouseUp() {
      this.endResize();
    },

    onTouchEnd() {
      this.endResize();
    },

    endResize() {
      if (!this.isDragging) return;

      this.isDragging = false;
      document.body.classList.remove('resizing');

      this.toggleIframe("auto")

      // Remove both mouse and touch event listeners
      document.removeEventListener('mousemove', this.onMouseMove);
      document.removeEventListener('touchmove', this.onTouchMove);
      document.removeEventListener('mouseup', this.onMouseUp);
      document.removeEventListener('touchend', this.onTouchEnd);
    },

    updatePreview() {
      if (this.isExecutionPaused) return;

      const preview = document.getElementById("preview-frame");
      if (!preview) return;

      // create a new iframe to replace the existing one
      const newFrame = document.createElement("iframe");
      newFrame.id = "preview-frame";

      // replace the old frame with the new one
      preview.parentNode.replaceChild(newFrame, preview);

      // write content to the new frame
      const doc = newFrame.contentDocument;
      doc.open();

      const content = `
        <!DOCTYPE html>
        <html>
          <head>
            <style>${this.css || ""}</style>
            <!-- Eruda console for debugging -->
            <script src="/libraries/eruda/eruda.min.js"></script>
          </head>
          <body>
            ${this.html || ""}
            ${
              this.showConsole
                ? `<script>window.eruda && eruda.init({
              useShadowDom: true,
              autoScale: true,
              defaults: {
                  displaySize: 50,
                  transparency: 0.9,
                  theme: 'Monokai Pro'
              }
              
              });
              eruda.show();
              </script>`
                : ""
            }
            <script>
              ${this.js || ""}
            </script>
          </body>
        </html>`;

      try {
        doc.write(content);
        doc.close();
      } catch (error) {
        console.error("Preview update error:", error);
      }
    },

    switchTab(tabId) {
      this.activeTab = tabId;
      // re-highlight code when switching tabs
      this.$nextTick(() => {
        this.highlightCode(this[tabId], tabId);
        const editor = document.querySelector(".editor-content textarea");
        if (editor) editor.focus();
      });
    },

    // ==================== Authentication ====================
    async login() {
      this.isLoggingIn = true;
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: this.loginEmail,
            password: this.loginPassword,
          }),
        });

        if (!response.ok) {
          throw new Error("Login failed");
        }

        const data = await response.json();
        this.token = data.token;
        localStorage.setItem("token", data.token);
        this.showLogin = false;
        this.loginEmail = "";
        this.loginPassword = "";
        this.showToast("Login successful!", "success");
      } catch (error) {
        this.showToast("Login failed. Please check your credentials.", "error");
      } finally {
        this.isLoggingIn = false;
      }
    },

    logout() {
      this.token = null;
      localStorage.removeItem("token");
      this.showToast("Logged out successfully", "info");
    },

    // ==================== Snippet Management ====================
    async saveSnippet() {
      if (!this.token) {
        this.showLogin = true;
        return;
      }

      this.isSaving = true;
      try {
        const response = await fetch("/api/snippets", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.token}`,
          },
          body: JSON.stringify({
            title: this.title || "Untitled",
            html: this.html,
            css: this.css,
            js: this.js,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to save snippet");
        }

        const data = await response.json();
        this.currentShareId = data.shareId;
        this.shareUrl = `${window.location.origin}/?share=${data.shareId}`;
        this.showShareModal = true;
        this.showToast("Snippet saved successfully!", "success");
      } catch (error) {
        this.showToast("Failed to save snippet. Please try again.", "error");
      } finally {
        this.isSaving = false;
      }
    },

    async loadSharedSnippet(shareId) {
      try {
        const response = await fetch(`/api/snippets/share/${shareId}`);
        if (!response.ok) {
          throw new Error("Failed to load snippet");
        }

        const data = await response.json();
        this.title = data.title;
        this.html = data.html;
        this.css = data.css;
        this.js = data.js;

        this.rehighlightCode();
        this.updatePreview();
        this.showToast("Snippet loaded successfully!", "success");
      } catch (error) {
        this.showToast("Failed to load shared snippet", "error");
      }
    },

    async copyShareUrl() {
      try {
        await navigator.clipboard.writeText(this.shareUrl);
        this.showToast("Link copied to clipboard!", "success");
      } catch (error) {
        this.showToast("Failed to copy link. Please copy manually.", "error");
      }
    },

    /**@param {"auto" | "none"} setting */
    toggleIframe(setting) {
      const iframe = document.getElementById("preview-frame");
      if (!iframe) return
      iframe.style.pointerEvents = setting;
    },

  },
}).mount("#app");
