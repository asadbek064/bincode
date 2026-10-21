const { createApp } = Vue;

createApp({
  data() {
    return {
      token: localStorage.getItem("token"),
      showLogin: false,
      showShareModal: false,
      loginEmail: "",
      loginPassword: "",
      title: "",
      html: `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>Title</title>
  </head>
  <body>

  </body>
</html>
      `,
      css: "",
      js: "",
      shareUrl: "",
      currentShareId: null,
      isDragging: false,
      startX: null,
      startWidth: null,
      containerWidth: null,
      editorWidth: "50%",
      minWidth: 250,
      maxWidth: null,
      // Tab state
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
      extraIcons: [
        {
          visible: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#5f6368"><path d="M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200Zm0-300Zm0 220q113 0 207.5-59.5T832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280Z"/></svg>`,
        },
        {
          hidden: `<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#5f6368"><path d="m644-428-58-58q9-47-27-88t-93-32l-58-58q17-8 34.5-12t37.5-4q75 0 127.5 52.5T660-500q0 20-4 37.5T644-428Zm128 126-58-56q38-29 67.5-63.5T832-500q-50-101-143.5-160.5T480-720q-29 0-57 4t-55 12l-62-62q41-17 84-25.5t90-8.5q151 0 269 83.5T920-500q-23 59-60.5 109.5T772-302Zm20 246L624-222q-35 11-70.5 16.5T480-200q-151 0-269-83.5T40-500q21-53 53-98.5t73-81.5L56-792l56-56 736 736-56 56ZM222-624q-29 26-53 57t-41 67q50 101 143.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z"/></svg>`,
        },
        {
          console: `
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="#5f6368"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H160v400Zm140-40-56-56 103-104-104-104 57-56 160 160-160 160Zm180 0v-80h240v80H480Z"/></svg>`,
        },
        {
          console_hiddne: `
<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M4 20C3.45 20 2.97917 19.8042 2.5875 19.4125C2.19583 19.0208 2 18.55 2 18V6C2 5.45 2.19583 4.97917 2.5875 4.5875C2.97917 4.19583 3.45 4 4 4H20C20.55 4 21.0208 4.19583 21.4125 4.5875C21.8042 4.97917 22 5.45 22 6V18C22 18.55 21.8042 19.0208 21.4125 19.4125C21.0208 19.8042 20.55 20 20 20H4ZM4 18H20V8H4V18ZM7.5 17L6.1 15.6L8.675 13L6.075 10.4L7.5 9L11.5 13L7.5 17ZM12 17V15H18V17H12Z" fill="#5F6368"/>
<rect x="3.43359" y="2" width="26.3532" height="2" transform="rotate(45.8073 3.43359 2)" fill="#5F6368"/>
</svg>
`,
        },
      ],
      monacoLoaded: false,
      monacoEditor: null,
      monacoModels: null,
      showEditor: true,
      showPreview: true,
      isExecutionPaused: false,
      updateTimer: null,
      showConsole: false,
      playIcon: `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path fill="currentColor" d="M320-200v-560l440 280-440 280Zm80-280Zm0 134 210-134-210-134v268Z"/></svg>`,
      pauseIcon: `<svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24"><path fill="currentColor" d="M520-200v-560h240v560H520Zm-320 0v-560h240v560H200Zm400-80h80v-400h-80v400Zm-320 0h80v-400h-80v400Zm320-400Zm-320 0Z"/></svg>`,
    };
  },

  computed: {
    previewWidth() {
      if (
        typeof this.editorWidth === "string" &&
        this.editorWidth.endsWith("%")
      ) {
        return 100 - parseInt(this.editorWidth) + "%";
      }
      return `calc(100% - ${this.editorWidth})`;
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
    this.updatePreviewDebounced = this.debounce(this.updatePreview, 50);
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get("share");
    if (shareId) {
      this.loadSharedSnippet(shareId);
    }
  },

  mounted() {
    this.initializeLayout();
    document.addEventListener("keydown", this.handleKeyboardShortcuts);
    this.initMonaco();

    // ensure iframe is loaded before updating the preview
    const preview = document.getElementById("preview-frame");
    if (preview) {
      preview.onload = () => {
        this.updatePreview();
      };
    }

    // relayout Monaco on window resize
    window.addEventListener('resize', this._onWindowResize = () => {
      if (this.monacoEditor) this.monacoEditor.layout();
    });
  },
  beforeUnmount() {
    if (this.monacoEditor) this.monacoEditor.dispose();
    if (this.monacoModels) {
      Object.values(this.monacoModels).forEach(m => m.dispose());
    }
    document.removeEventListener("keydown", this.handleKeyboardShortcuts);
    window.removeEventListener('resize', this._onWindowResize);
  },

  methods: {
    initMonaco() {
      const baseUrl = window.location.origin + '/libraries/monaco/vs';

      require.config({ paths: { vs: baseUrl } });

      // Configure workers to load through AMD loader
      window.MonacoEnvironment = {
        getWorkerUrl: function () {
          return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
            self.MonacoEnvironment = { baseUrl: '${baseUrl}/../' };
            importScripts('${baseUrl}/base/worker/workerMain.js');
          `)}`;
        }
      };

      require(['vs/editor/editor.main'], () => {
        this.monacoLoaded = true;

        // Wait for Vue to make the container visible before creating editor
        this.$nextTick(() => {
          this.createMonacoEditor();
        });
      }, (err) => {
        console.error('Monaco failed to load:', err);
      });
    },

    createMonacoEditor() {
      // Create one model per tab to preserve undo history
      this.monacoModels = {
        html: monaco.editor.createModel(this.html, 'html'),
        css: monaco.editor.createModel(this.css, 'css'),
        js: monaco.editor.createModel(this.js, 'javascript'),
      };

      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

      this.monacoEditor = monaco.editor.create(
        document.getElementById('monaco-container'),
        {
          model: this.monacoModels[this.activeTab],
          theme: isDark ? 'vs-dark' : 'vs',
          automaticLayout: true,
          minimap: { enabled: false },
          fontSize: 14,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          tabSize: 2,
          insertSpaces: true,
          wordWrap: 'off',
          renderWhitespace: 'none',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: {
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
          },
          padding: { top: 8 },
        }
      );

      // Sync model content changes back to Vue data
      Object.keys(this.monacoModels).forEach((tab) => {
        this.monacoModels[tab].onDidChangeContent(() => {
          this[tab] = this.monacoModels[tab].getValue();
        });
      });

      // System theme listener
      window.matchMedia('(prefers-color-scheme: dark)')
        .addEventListener('change', (e) => {
          monaco.editor.setTheme(e.matches ? 'vs-dark' : 'vs');
        });

      // Ctrl+S save inside Monaco
      this.monacoEditor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
        () => { this.saveSnippet(); }
      );

      this.updatePreview();
    },

    toggleConsole() {
      this.showConsole = !this.showConsole;
      this.updatePreview();
    },
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

    toggleExecution() {
      this.isExecutionPaused = !this.isExecutionPaused;
      if (!this.isExecutionPaused) {
        // resume execution
        this.updatePreview();
      }
    },

    toggleEditor() {
      this.showEditor = !this.showEditor;
      this.$nextTick(() => {
        if (this.monacoEditor) this.monacoEditor.layout();
      });
    },
    togglePreview() {
      this.showPreview = !this.showPreview;
      if (!this.showPreview) {
        this.editorWidth = "100%";
      } else {
        this.editorWidth = "50%";
      }
      this.$nextTick(() => {
        if (this.monacoEditor) this.monacoEditor.layout();
      });
    },
    debounce(fn, delay) {
      let timeoutId;
      return function (...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
      };
    },

    handleKeyboardShortcuts(e) {
      // handle Ctrl/Cmd + number for tab switching
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const num = parseInt(e.key);
        if (num >= 1 && num <= this.tabs.length) {
          e.preventDefault();
          this.switchTab(this.tabs[num - 1].id);
        }
      }

      // handle Ctrl/Cmd + S for save (for when focus is outside Monaco)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        this.saveSnippet();
      }
    },

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

    startResize(event) {
      event.preventDefault();
      this.isDragging = true;

      // Get clientX from either mouse or touch event
      this.startX = event.clientX || (event.touches && event.touches[0].clientX);

      const editorGroup = document.querySelector(".editor-group");
      this.startWidth = editorGroup.offsetWidth;

      // Recalculate container bounds each drag start
      const container = document.querySelector(".editor-container");
      this.containerWidth = container.offsetWidth;
      this.maxWidth = this.containerWidth - this.minWidth;

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
      if (this._rafId) return;
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        const deltaX = clientX - this.startX;
        const newWidth = Math.max(this.minWidth, Math.min(this.startWidth + deltaX, this.maxWidth));
        this.editorWidth = `${newWidth}px`;
      });
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
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      document.body.classList.remove('resizing');

      this.toggleIframe("auto")

      // Trigger Monaco relayout after resize
      if (this.monacoEditor) {
        this.monacoEditor.layout();
      }

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
      if (this.monacoEditor && this.monacoModels) {
        this.monacoEditor.setModel(this.monacoModels[tabId]);
        this.monacoEditor.focus();
      }
    },

    async login() {
      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: this.loginEmail,
            password: this.loginPassword,
          }),
        });

        if (!response.ok) throw new Error("Login failed");

        const data = await response.json();
        this.token = data.token;
        localStorage.setItem("token", data.token);
        this.showLogin = false;
      } catch (error) {
        alert("Login failed");
      }
    },

    logout() {
      this.token = null;
      localStorage.removeItem("token");
    },

    async saveSnippet() {
      if (!this.token) {
        this.showLogin = true;
        return;
      }

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

        if (!response.ok) throw new Error("Failed to save snippet");

        const data = await response.json();
        this.currentShareId = data.shareId;
        this.shareUrl = `${window.location.origin}/?share=${data.shareId}`;
        this.showShareModal = true;
      } catch (error) {
        alert("Failed to save snippet");
      }
    },

    async loadSharedSnippet(shareId) {
      try {
        const response = await fetch(`/api/snippets/share/${shareId}`);
        if (!response.ok) throw new Error("Failed to load snippet");

        const data = await response.json();
        this.title = data.title;
        this.html = data.html;
        this.css = data.css;
        this.js = data.js;

        // Update Monaco models if loaded
        if (this.monacoModels) {
          this.monacoModels.html.setValue(this.html);
          this.monacoModels.css.setValue(this.css);
          this.monacoModels.js.setValue(this.js);
        }

        this.updatePreview();
      } catch (error) {
        alert("Failed to load shared snippet");
      }
    },

    async copyShareUrl() {
      try {
        await navigator.clipboard.writeText(this.shareUrl);
      } catch (error) {
        alert("Failed to copy URL");
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
