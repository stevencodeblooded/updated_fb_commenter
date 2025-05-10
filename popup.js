document.addEventListener("DOMContentLoaded", function () {
  // Import auth module
  import("./auth.js")
    .then((authModule) => {
      // Get auth manager
      const authManager = authModule.default;

      // Continue with regular functionality after authentication is handled in auth.js
      initializeApp();
    })
    .catch((error) => {
      console.error("Error importing auth module:", error);
      // Show error message
      document.body.innerHTML = `
      <div style="padding: 20px; color: red; text-align: center;">
        <h3>Error Loading Extension</h3>
        <p>There was a problem loading the authentication module. Please try reloading the extension.</p>
      </div>
    `;
    });

  function initializeApp() {
    // Tab navigation
    const tabs = document.querySelectorAll(".tab");
    const tabContents = document.querySelectorAll(".tab-content");

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const tabId = tab.getAttribute("data-tab");

        // Update active tab
        tabs.forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");

        // Update active content
        tabContents.forEach((content) => {
          content.classList.remove("active");
          if (content.id === `${tabId}-tab`) {
            content.classList.add("active");
          }
        });
      });
    });

    // Comment mode toggle
    const commentModeSelect = document.getElementById("comment-mode");
    const singleCommentSection = document.getElementById(
      "single-comment-section"
    );
    const multiCommentSection = document.getElementById(
      "multi-comment-section"
    );

    commentModeSelect.addEventListener("change", function () {
      if (this.value === "single") {
        singleCommentSection.style.display = "block";
        multiCommentSection.style.display = "none";
      } else {
        singleCommentSection.style.display = "none";
        multiCommentSection.style.display = "block";
      }
    });

    // UI elements
    const commentInput = document.getElementById("comment");
    const commentsInput = document.getElementById("comments");
    const urlsInput = document.getElementById("urls");
    const delayInput = document.getElementById("delay");
    const randomizeCheckbox = document.getElementById("randomize");
    const startButton = document.getElementById("start");
    const stopButton = document.getElementById("stop");
    const resumeButton = document.getElementById("resume"); // New resume button
    const statusDiv = document.getElementById("status");
    const progressContainer = document.getElementById("progress-container");
    const progressBar = document.getElementById("progress-bar");
    const progressText = document.getElementById("progress-text");
    const modalHandlingCheckbox = document.getElementById("modal-handling");
    const skipCommentedCheckbox = document.getElementById("skip-commented");
    const debugModeCheckbox = document.getElementById("debug-mode");
    const clearHistoryButton = document.getElementById("clear-history");
    const useExistingTabCheckbox = document.getElementById("use-existing-tab"); // New checkbox

    // History elements
    const successfulUrlsDiv = document.getElementById("successful-urls");
    const skippedUrlsDiv = document.getElementById("skipped-urls");
    const failedUrlsDiv = document.getElementById("failed-urls");

    // Initially hide the resume button
    if (resumeButton) {
      resumeButton.style.display = "none";
    }

    // Load state on popup open
    loadState();
    loadHistory();

    // Start button click handler
    startButton.addEventListener("click", function () {
      const urls = urlsInput.value
        .trim()
        .split("\n")
        .filter((url) => url.trim());

      if (urls.length === 0) {
        showStatus("Please enter at least one URL", "error");
        return;
      }

      let comment = "";
      let comments = [];
      const isMultiCommentMode = commentModeSelect.value === "multi";

      if (isMultiCommentMode) {
        comments = commentsInput.value
          .trim()
          .split("\n")
          .filter((c) => c.trim());
        if (comments.length === 0) {
          showStatus("Please enter at least one comment", "error");
          return;
        }
      } else {
        comment = commentInput.value.trim();
        if (!comment) {
          showStatus("Please enter a comment", "error");
          return;
        }
      }

      const delay = parseInt(delayInput.value, 10) || 15;
      const randomize = randomizeCheckbox.checked;
      const modalHandling = modalHandlingCheckbox.checked;
      const skipCommented = skipCommentedCheckbox.checked;
      const debugMode = debugModeCheckbox.checked;
      const useExistingTab = useExistingTabCheckbox
        ? useExistingTabCheckbox.checked
        : true;

      // Update UI
      startButton.disabled = true;
      stopButton.disabled = false;
      if (resumeButton) resumeButton.style.display = "none";
      statusDiv.textContent = "Starting commenting process...";
      statusDiv.className = "status";
      statusDiv.style.display = "block";
      progressContainer.style.display = "block";
      progressBar.style.width = "0%";
      progressBar.textContent = "0%";
      progressText.textContent = "Preparing to comment...";

      // Send message to background script
      chrome.runtime.sendMessage(
        {
          action: "startCommenting",
          posts: urls,
          comment: comment,
          comments: comments,
          multiCommentMode: isMultiCommentMode,
          delay: delay,
          randomize: randomize,
          modalHandling: modalHandling,
          skipCommented: skipCommented,
          debugMode: debugMode,
          useExistingTab: useExistingTab,
        },
        function (response) {
          if (response && response.success) {
            showStatus("Commenting process started", "success");
          } else {
            showStatus("Failed to start commenting", "error");
            startButton.disabled = false;
            stopButton.disabled = true;
          }
        }
      );
    });

    // Stop button click handler
    stopButton.addEventListener("click", function () {
      chrome.runtime.sendMessage(
        { action: "stopCommenting" },
        function (response) {
          showStatus("Commenting process stopped", "success");
          startButton.disabled = false;
          stopButton.disabled = true;
          if (resumeButton) resumeButton.style.display = "none";
        }
      );
    });

    // Resume button click handler
    if (resumeButton) {
      resumeButton.addEventListener("click", function () {
        chrome.runtime.sendMessage(
          { action: "resumeCommenting" },
          function (response) {
            if (response && response.success) {
              showStatus("Commenting process resumed", "success");
              startButton.disabled = true;
              stopButton.disabled = false;
              resumeButton.style.display = "none";
            } else {
              showStatus("Failed to resume commenting", "error");
            }
          }
        );
      });
    }

    // Clear history button click handler
    clearHistoryButton.addEventListener("click", function () {
      chrome.runtime.sendMessage(
        { action: "clearCommentHistory" },
        function (response) {
          loadHistory();
          showStatus("Comment history cleared", "success");
        }
      );
    });

    // Listen for updates from background script
    chrome.runtime.onMessage.addListener(function (
      request,
      sender,
      sendResponse
    ) {
      if (request.action === "commentProgress") {
        const { currentIndex, totalPosts, success, warning, usedComment } =
          request;

        // Update progress
        const percentage = Math.round((currentIndex / totalPosts) * 100);
        progressBar.style.width = percentage + "%";
        progressBar.textContent = percentage + "%";

        let statusText = `Processing post ${currentIndex} of ${totalPosts}`;
        if (warning) {
          statusText += ` (Warning: ${warning})`;
        }

        if (usedComment) {
          statusText += `\nComment: "${usedComment}"`;
        }

        progressText.textContent = statusText;

        // Refresh history if changed
        loadHistory();
      } else if (request.action === "commentSkipped") {
        const { currentIndex, totalPosts, message } = request;

        // Update progress for skipped posts
        const percentage = Math.round((currentIndex / totalPosts) * 100);
        progressBar.style.width = percentage + "%";
        progressBar.textContent = percentage + "%";

        progressText.textContent = `Post ${currentIndex} of ${totalPosts} skipped: ${message}`;

        // Refresh history
        loadHistory();
      } else if (request.action === "commentError") {
        const { currentIndex, totalPosts, error, isModalError, isPaused } =
          request;

        if (currentIndex && totalPosts) {
          // Update progress for error case
          const percentage = Math.round((currentIndex / totalPosts) * 100);
          progressBar.style.width = percentage + "%";
          progressBar.textContent = percentage + "%";

          let errorMessage = `Error on post ${currentIndex} of ${totalPosts}: ${error}`;
          if (isModalError) {
            errorMessage += " (Modal Dialog Issue)";
          }

          progressText.textContent = errorMessage;
        } else {
          // Fatal error
          progressText.textContent = `Fatal error: ${error}`;
          startButton.disabled = false;
          stopButton.disabled = true;
        }

        // Show resume button if process is paused
        if (isPaused && resumeButton) {
          resumeButton.style.display = "block";
          stopButton.disabled = true;
          startButton.disabled = true;

          // Show special status for paused state
          showStatus(
            "Process paused due to errors. Check your internet connection and click Resume to continue.",
            "error",
            false
          );
        }

        // Refresh history
        loadHistory();
      } else if (request.action === "commentingComplete") {
        const { message, successfulCount, failedCount, skippedPosts } = request;

        // Update UI for completion
        showStatus(message, "success");
        startButton.disabled = false;
        stopButton.disabled = true;
        if (resumeButton) resumeButton.style.display = "none";

        // Create detailed completion message
        let completionText = message;
        if (successfulCount > 0 || failedCount > 0 || skippedPosts > 0) {
          completionText += `\n\nSummary: ${successfulCount} successful, ${failedCount} failed, ${skippedPosts} skipped`;
        }

        progressText.textContent = completionText;
        progressBar.style.width = "100%";
        progressBar.textContent = "100%";

        // Refresh history at completion
        loadHistory();
      }
    });

    // Helper functions
    function showStatus(message, type, autoHide = true) {
      statusDiv.textContent = message;
      statusDiv.className = "status " + (type || "");
      statusDiv.style.display = "block";

      // Auto-hide status after 5 seconds for non-error messages or if explicitly requested
      if (type !== "error" && autoHide) {
        setTimeout(() => {
          statusDiv.style.display = "none";
        }, 5000);
      }
    }

    function loadState() {
      chrome.runtime.sendMessage(
        { action: "getCommentingState" },
        function (state) {
          if (state && state.isCommenting) {
            // Show current progress if commenting is in progress
            startButton.disabled = true;
            stopButton.disabled = false;
            progressContainer.style.display = "block";

            // Handle paused state
            if (state.isPaused && resumeButton) {
              resumeButton.style.display = "block";
              stopButton.disabled = true;
              showStatus(
                "Process is paused due to errors. Click Resume to continue.",
                "error",
                false
              );
            } else if (resumeButton) {
              resumeButton.style.display = "none";
            }

            // Calculate percentage
            const percentage =
              state.posts.length > 0
                ? Math.round((state.currentIndex / state.posts.length) * 100)
                : 0;

            progressBar.style.width = percentage + "%";
            progressBar.textContent = percentage + "%";
            progressText.textContent = `Processing post ${state.currentIndex} of ${state.posts.length}`;

            if (state.multiCommentMode) {
              commentModeSelect.value = "multi";
              singleCommentSection.style.display = "none";
              multiCommentSection.style.display = "block";

              commentsInput.value = state.comments.join("\n");
              randomizeCheckbox.checked = state.randomize;
            } else {
              commentModeSelect.value = "single";
              singleCommentSection.style.display = "block";
              multiCommentSection.style.display = "none";

              commentInput.value = state.comment;
            }

            delayInput.value = state.delay;

            // Pre-fill URLs
            urlsInput.value = state.posts.join("\n");

            // Set debug mode checkbox if applicable
            if (debugModeCheckbox) {
              debugModeCheckbox.checked = state.debugMode || false;
            }
          }
        }
      );
    }

    function loadHistory() {
      chrome.runtime.sendMessage(
        { action: "getCommentHistory" },
        function (history) {
          if (!history) return;

          // Display successful URLs
          if (history.successfulUrls && history.successfulUrls.length > 0) {
            successfulUrlsDiv.innerHTML = "";
            history.successfulUrls.slice(0, 10).forEach((item) => {
              const div = document.createElement("div");
              div.className = "history-item";

              // Format date
              const date = new Date(item.timestamp);
              const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

              div.innerHTML = `
            <div><strong>URL:</strong> <a href="${
              item.url
            }" target="_blank">${formatUrl(item.url)}</a></div>
            <div><strong>Comment:</strong> ${item.comment.substring(0, 50)}${
                item.comment.length > 50 ? "..." : ""
              }</div>
            <div><strong>Date:</strong> ${formattedDate}</div>
          `;
              successfulUrlsDiv.appendChild(div);
            });
          } else {
            successfulUrlsDiv.innerHTML =
              "<div>No successful comments yet</div>";
          }

          // Display skipped URLs
          if (history.skippedUrls && history.skippedUrls.length > 0) {
            skippedUrlsDiv.innerHTML = "";
            history.skippedUrls.slice(0, 10).forEach((item) => {
              const div = document.createElement("div");
              div.className = "history-item";

              const date = new Date(item.timestamp);
              const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

              div.innerHTML = `
            <div><strong>URL:</strong> <a href="${
              item.url
            }" target="_blank">${formatUrl(item.url)}</a></div>
            <div><strong>Reason:</strong> ${item.reason}</div>
            <div><strong>Date:</strong> ${formattedDate}</div>
          `;
              skippedUrlsDiv.appendChild(div);
            });
          } else {
            skippedUrlsDiv.innerHTML = "<div>No skipped posts yet</div>";
          }

          // Display failed URLs
          if (history.failedUrls && history.failedUrls.length > 0) {
            failedUrlsDiv.innerHTML = "";
            history.failedUrls.slice(0, 10).forEach((item) => {
              const div = document.createElement("div");
              div.className = "history-item";

              const date = new Date(item.timestamp);
              const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;

              // Highlight modal errors
              const isModalError =
                item.reason.includes("modal") ||
                item.reason.includes("dialog") ||
                item.reason.includes("focus");

              // Highlight connection errors
              const isConnectionError =
                item.reason.includes("connection") ||
                item.reason.includes("disconnected") ||
                item.reason.includes("timed out");

              div.innerHTML = `
            <div><strong>URL:</strong> <a href="${
              item.url
            }" target="_blank">${formatUrl(item.url)}</a></div>
            <div><strong>Error:</strong> ${
              isModalError
                ? '<span style="color:#1877F2">(Modal Issue)</span> '
                : isConnectionError
                ? '<span style="color:#FF5722">(Connection Issue)</span> '
                : ""
            }${item.reason}</div>
            <div><strong>Date:</strong> ${formattedDate}</div>
          `;
              failedUrlsDiv.appendChild(div);
            });
          } else {
            failedUrlsDiv.innerHTML = "<div>No failed comments yet</div>";
          }
        }
      );
    }

    // Helper to format long URLs for display
    function formatUrl(url) {
      if (url.length <= 50) return url;
      return url.substring(0, 47) + "...";
    }
  }
});