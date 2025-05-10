// Enhanced background.js for Facebook Auto Commenter

// Constants for timeouts
const MODAL_RESPONSE_TIMEOUT = 45000; // 45 seconds for modal posts
const STANDARD_RESPONSE_TIMEOUT = 30000; // 30 seconds for regular posts
const MAX_HISTORY_ITEMS = 50; // Maximum number of URLs to store in history
const MAX_CONSECUTIVE_FAILURES = 3; // Maximum allowed consecutive failures before pausing

// State management for commenting
let commentingState = {
  isCommenting: false,
  posts: [],
  currentIndex: 0,
  comment: "", // For backward compatibility
  comments: [], // Array of comments for multi-comment mode
  commentIndex: 0, // Track which comment was last used
  multiCommentMode: false,
  delay: 15,
  randomize: false,
  skippedPosts: 0, // Counter for skipped posts
  usedCommentIndices: [], // Track which comments have been used (for non-repeat random)
  consecutiveFailures: 0, // Track consecutive failures
  isPaused: false, // Track if process is paused due to errors
};

// Comment history for tracking success/failure of URLs
let commentHistory = {
  successfulUrls: [], // {url, timestamp, comment}
  failedUrls: [], // {url, timestamp, reason}
  skippedUrls: [], // {url, timestamp, reason}
};

// Store the active tab when commenting starts
let activeTabId = null;
let isTabProcessing = false; // Flag to indicate a tab is currently processing

// Save state to storage
function saveState() {
  console.log("Saving state:", commentingState);
  return chrome.storage.local.set({ commentingState });
}

// Save comment history to storage
function saveCommentHistory() {
  console.log("Saving comment history:", commentHistory);
  return chrome.storage.local.set({ commentHistory });
}

// Load state from storage
async function loadState() {
  try {
    const result = await chrome.storage.local.get(["commentingState"]);
    if (result.commentingState) {
      commentingState = result.commentingState;
      console.log("Loaded state:", commentingState);
    }
  } catch (error) {
    console.error("Error loading state:", error);
  }
  return commentingState;
}

// Load comment history from storage
async function loadCommentHistory() {
  try {
    const result = await chrome.storage.local.get(["commentHistory"]);
    if (result.commentHistory) {
      commentHistory = result.commentHistory;
      console.log("Loaded comment history:", commentHistory);
    }
  } catch (error) {
    console.error("Error loading comment history:", error);
  }
  return commentHistory;
}

// Record successful comment
function recordSuccessfulComment(url, comment) {
  // Add to the beginning of the array
  commentHistory.successfulUrls.unshift({
    url: url,
    timestamp: Date.now(),
    comment: comment,
  });

  // Trim array if it gets too large
  if (commentHistory.successfulUrls.length > MAX_HISTORY_ITEMS) {
    commentHistory.successfulUrls = commentHistory.successfulUrls.slice(
      0,
      MAX_HISTORY_ITEMS
    );
  }

  saveCommentHistory();
}

// Record failed comment
function recordFailedComment(url, reason) {
  // Add to the beginning of the array
  commentHistory.failedUrls.unshift({
    url: url,
    timestamp: Date.now(),
    reason: reason,
  });

  // Trim array if it gets too large
  if (commentHistory.failedUrls.length > MAX_HISTORY_ITEMS) {
    commentHistory.failedUrls = commentHistory.failedUrls.slice(
      0,
      MAX_HISTORY_ITEMS
    );
  }

  saveCommentHistory();
}

// Record skipped post
function recordSkippedPost(url, reason) {
  // Add to the beginning of the array
  commentHistory.skippedUrls.unshift({
    url: url,
    timestamp: Date.now(),
    reason: reason,
  });

  // Trim array if it gets too large
  if (commentHistory.skippedUrls.length > MAX_HISTORY_ITEMS) {
    commentHistory.skippedUrls = commentHistory.skippedUrls.slice(
      0,
      MAX_HISTORY_ITEMS
    );
  }

  saveCommentHistory();
}

// Reset state
function resetState() {
  commentingState = {
    isCommenting: false,
    posts: [],
    currentIndex: 0,
    comment: "",
    comments: [],
    commentIndex: 0,
    multiCommentMode: false,
    delay: 5,
    randomize: false,
    skippedPosts: 0,
    usedCommentIndices: [],
    debugMode: false,
    consecutiveFailures: 0,
    isPaused: false,
  };
  console.log("State reset");
  return saveState();
}

// Enhanced debugLog function
function debugLog(...args) {
  if (commentingState.debugMode) {
    console.log("[DEBUG]", ...args);
  }
}

// Select next comment based on strategy (random or sequential)
function selectNextComment() {
  if (!commentingState.multiCommentMode) {
    return commentingState.comment || ""; // Return single comment mode comment
  }

  const comments = commentingState.comments;
  if (!comments || comments.length === 0) {
    return commentingState.comment || ""; // Fallback to old behavior
  }

  let selectedIndex;
  let selectedComment;

  if (commentingState.randomize) {
    // Random selection with no immediate repeats
    const availableIndices = [];

    // If all comments have been used, reset tracking
    if (commentingState.usedCommentIndices.length >= comments.length) {
      commentingState.usedCommentIndices = [];
    }

    // Find indices not yet used
    for (let i = 0; i < comments.length; i++) {
      if (!commentingState.usedCommentIndices.includes(i)) {
        availableIndices.push(i);
      }
    }

    // If no available indices (should not happen), use any random index
    if (availableIndices.length === 0) {
      selectedIndex = Math.floor(Math.random() * comments.length);
    } else {
      // Pick a random index from available ones
      const randomPosition = Math.floor(
        Math.random() * availableIndices.length
      );
      selectedIndex = availableIndices[randomPosition];
    }

    // Mark this index as used
    commentingState.usedCommentIndices.push(selectedIndex);
    commentingState.commentIndex = selectedIndex;
    selectedComment = comments[selectedIndex];
  } else {
    // Sequential selection with wrap-around
    selectedIndex = commentingState.commentIndex % comments.length;
    selectedComment = comments[selectedIndex];

    // Update for next time
    commentingState.commentIndex = (selectedIndex + 1) % comments.length;
  }

  console.log(`Selected comment #${selectedIndex + 1}: "${selectedComment}"`);
  return selectedComment;
}

// Check if tab still exists
async function isTabValid(tabId) {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (error) {
    console.log(`Tab ${tabId} is no longer valid:`, error);
    return false;
  }
}

// Process next post with improved navigation and reliability
async function processNextPost() {
  // Skip if another post is already processing (prevents parallel processing)
  if (isTabProcessing) {
    console.log("Another post is currently processing, waiting...");
    setTimeout(processNextPost, 5000); // Try again in 5 seconds
    return;
  }

  isTabProcessing = true;

  try {
    await loadState();

    // Check if we're done or stopped
    if (
      !commentingState.isCommenting ||
      commentingState.currentIndex >= commentingState.posts.length
    ) {
      // Load comment history to get accurate counts
      const history = await loadCommentHistory();

      // Calculate statistics
      const successfulCount =
        commentingState.currentIndex - commentingState.skippedPosts;

      const failedCount =
        commentingState.posts.length -
        successfulCount -
        commentingState.skippedPosts;

      // Send complete message with full stats
      const finalMessage =
        commentingState.skippedPosts > 0
          ? `Commenting completed. ${successfulCount} posts were commented on successfully, ${commentingState.skippedPosts} posts were skipped (already commented on).`
          : "Commenting process finished successfully.";

      // Save the current state for reference before resetting
      const skippedPosts = commentingState.skippedPosts;

      // Now reset the state
      await resetState();
      isTabProcessing = false;

      // Send enhanced message with counts
      chrome.runtime.sendMessage({
        action: "commentingComplete",
        message: finalMessage,
        successfulCount: successfulCount,
        failedCount: failedCount,
        skippedPosts: skippedPosts,
      });
      return;
    }

    // Check if process is paused due to too many consecutive errors
    if (commentingState.isPaused) {
      console.log("Process is paused due to too many consecutive failures");

      // Notify popup
      chrome.runtime.sendMessage({
        action: "commentError",
        error:
          "Process paused: Too many consecutive errors. Check your internet connection or try again later.",
        isPaused: true,
      });

      // Reset pause after some time
      commentingState.consecutiveFailures = 0;
      commentingState.isPaused = false;
      await saveState();

      isTabProcessing = false;
      return;
    }

    const currentUrl = commentingState.posts[commentingState.currentIndex];
    const selectedComment = selectNextComment();

    // Initialize isModal at the top level of the function scope
    let isModal = false;

    console.log(
      `Processing post ${commentingState.currentIndex + 1}/${
        commentingState.posts.length
      }`
    );
    console.log(`URL: ${currentUrl}`);
    console.log(`Selected comment: "${selectedComment}"`);

    try {
      // Validate that the active tab is still valid
      if (activeTabId && !(await isTabValid(activeTabId))) {
        console.log("Active tab is no longer valid, finding a new one");
        activeTabId = null;
      }

      // Find or create a tab to use
      let targetTab;

      if (activeTabId) {
        // Use the existing active tab
        targetTab = await chrome.tabs.get(activeTabId);
        console.log("Using existing tab:", activeTabId);
      } else {
        // Find an existing Facebook tab or create a new one
        const facebookTabs = await chrome.tabs.query({
          url: ["https://web.facebook.com/*", "https://www.facebook.com/*"],
        });

        if (facebookTabs.length > 0) {
          targetTab = facebookTabs[0];
          activeTabId = targetTab.id;
          console.log("Using existing Facebook tab:", activeTabId);
        } else {
          // Create a new tab
          targetTab = await chrome.tabs.create({ url: currentUrl });
          activeTabId = targetTab.id;
          console.log("Created new tab:", activeTabId);

          // Wait for new tab to initialize
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }

      // Navigate to the post URL on the active tab
      console.log(`Navigating tab ${activeTabId} to ${currentUrl}`);
      await chrome.tabs.update(activeTabId, { url: currentUrl });

      // Wait for page load and Facebook to initialize
      console.log("Waiting for page to load completely...");
      await new Promise((resolve) => setTimeout(resolve, 8000));

      // Verify tab is still valid after loading
      if (!(await isTabValid(activeTabId))) {
        throw new Error("Tab was closed during navigation");
      }

      // Check for post modal and verify stability
      console.log("Verifying post stability...");
      let modalInfo = null;

      try {
        // Check if post is a modal
        const postVerification = await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error("Content script verification timed out"));
          }, 15000);

          chrome.tabs.sendMessage(
            activeTabId,
            { action: "verifyPostStability" },
            (response) => {
              clearTimeout(timeoutId);
              if (chrome.runtime.lastError) {
                reject(
                  new Error(
                    `Content script error: ${chrome.runtime.lastError.message}`
                  )
                );
              } else if (response) {
                resolve(response);
              } else {
                reject(new Error("No verification response received"));
              }
            }
          );
        });

        isModal = postVerification.isModal;
        modalInfo = postVerification.modalInfo;

        console.log("Post verification:", postVerification);

        if (isModal && modalInfo) {
          console.log("Modal post detected, waiting for stability...");

          // Wait for more time to ensure modal is fully loaded and stable
          await new Promise((resolve) => setTimeout(resolve, 5000));

          // Re-check modal to ensure it hasn't changed
          const stabilityCheck = await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              reject(new Error("Modal stability check timed out"));
            }, 15000);

            chrome.tabs.sendMessage(
              activeTabId,
              {
                action: "checkModalStability",
                previousInfo: modalInfo,
              },
              (response) => {
                clearTimeout(timeoutId);
                if (chrome.runtime.lastError) {
                  reject(
                    new Error(
                      `Modal stability check error: ${chrome.runtime.lastError.message}`
                    )
                  );
                } else if (response) {
                  resolve(response);
                } else {
                  reject(new Error("No stability response received"));
                }
              }
            );
          });

          if (!stabilityCheck.isStable) {
            console.log("Modal changed during waiting period, skipping post");
            throw new Error(
              "Modal post changed during stability check - background post interference detected"
            );
          }

          console.log("Modal is stable, proceeding with comment");
        }
      } catch (error) {
        console.error("Post verification error:", error);
        throw new Error("Could not verify post stability: " + error.message);
      }

      // Send message to content script with improved error handling
      console.log(`Sending comment message to tab ${activeTabId}`);

      // Use a promise with timeout for message handling
      const response = await Promise.race([
        new Promise((resolve, reject) => {
          const timeoutId = setTimeout(
            () => {
              reject(new Error("Comment process timed out"));
            },
            isModal ? MODAL_RESPONSE_TIMEOUT : STANDARD_RESPONSE_TIMEOUT
          );

          chrome.tabs.sendMessage(
            activeTabId,
            {
              action: "processPost",
              comment: selectedComment,
              delay: commentingState.delay * 1000,
              isModalContext: isModal,
              debugMode: commentingState.debugMode,
            },
            (response) => {
              clearTimeout(timeoutId);
              if (chrome.runtime.lastError) {
                reject(
                  new Error(
                    `Content script error: ${chrome.runtime.lastError.message}`
                  )
                );
              } else if (response) {
                resolve(response);
              } else {
                reject(new Error("No response received from content script"));
              }
            }
          );
        }),
        // Secondary timeout as fallback
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("Content script communication timed out")),
            (isModal ? MODAL_RESPONSE_TIMEOUT : STANDARD_RESPONSE_TIMEOUT) +
              5000
          )
        ),
      ]);

      console.log("Response from content script:", response);

      // Reset consecutive failures on success
      commentingState.consecutiveFailures = 0;

      // Handle skipped posts (already commented on)
      if (response.skipped) {
        console.log(
          `Post ${
            commentingState.currentIndex + 1
          } skipped: Already commented on`
        );
        commentingState.skippedPosts++;

        // Record skipped URL
        recordSkippedPost(
          currentUrl,
          response.message || "Already commented on"
        );

        // Send skipped post notification to popup
        chrome.runtime.sendMessage({
          action: "commentSkipped",
          currentIndex: commentingState.currentIndex + 1,
          totalPosts: commentingState.posts.length,
          url: currentUrl,
          message: response.message || "Post already commented on",
        });
      } else {
        // Record successful comment
        recordSuccessfulComment(currentUrl, selectedComment);

        // Send regular progress update to popup
        chrome.runtime.sendMessage({
          action: "commentProgress",
          currentIndex: commentingState.currentIndex + 1,
          totalPosts: commentingState.posts.length,
          url: currentUrl,
          success: response.success,
          warning: response.warning,
          usedComment: selectedComment, // Send the comment that was used
        });
      }
    } catch (error) {
      console.error("Error processing post:", error);

      // Track consecutive failures
      commentingState.consecutiveFailures++;

      // Check if we should pause the process due to too many errors
      if (commentingState.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        commentingState.isPaused = true;
        chrome.runtime.sendMessage({
          action: "commentError",
          error: `Process paused after ${MAX_CONSECUTIVE_FAILURES} consecutive failures. The last error was: ${error.message}`,
          isPaused: true,
        });
      }

      // Enhanced error handling for modal-specific issues
      let errorMessage = error.message;

      // Detect modal-specific errors
      if (
        isModal &&
        (error.message.includes("modal") ||
          error.message.includes("dialog") ||
          error.message.includes("focus"))
      ) {
        errorMessage = `Modal dialog error: ${error.message}. This might be due to Facebook's interface changes.`;
      }

      // Handle connection errors
      if (
        error.message.includes("could not establish connection") ||
        error.message.includes("disconnected") ||
        error.message.includes("timed out")
      ) {
        errorMessage = `Connection error: ${error.message}. Extension will continue trying to process posts.`;

        // Try to reset the tab
        activeTabId = null;
      }

      // Record failed comment with enhanced error info
      recordFailedComment(currentUrl, errorMessage);

      // Send error message to popup
      chrome.runtime.sendMessage({
        action: "commentError",
        currentIndex: commentingState.currentIndex + 1,
        totalPosts: commentingState.posts.length,
        url: currentUrl,
        error: `Error on post ${
          commentingState.currentIndex + 1
        }: ${errorMessage}`,
        isModalError: isModal,
      });
    }

    // Move to next post regardless of success or failure
    commentingState.currentIndex++;
    await saveState();

    // Release the processing lock
    isTabProcessing = false;

    // Schedule next post with the specified delay, but only if not paused
    if (!commentingState.isPaused) {
      setTimeout(processNextPost, commentingState.delay * 1000);
    }
  } catch (error) {
    console.error("Fatal error in processNextPost:", error);

    // Release the processing lock
    isTabProcessing = false;

    // Try to reset the active tab
    activeTabId = null;

    // Pause the process in case of fatal errors
    commentingState.isPaused = true;
    await saveState();

    chrome.runtime.sendMessage({
      action: "commentError",
      error: `Fatal error: ${error.message}. Process has been paused.`,
      isPaused: true,
    });
  }
}

// Add handler for resuming the process
async function resumeCommenting() {
  console.log("Resuming commenting process");
  await loadState();

  if (commentingState.isCommenting) {
    commentingState.isPaused = false;
    commentingState.consecutiveFailures = 0;
    await saveState();

    // Only start if not already processing
    if (!isTabProcessing) {
      processNextPost();
    }
  }
}

// Message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Background received message:", request);

  switch (request.action) {
    case "startCommenting":
      console.log("Starting commenting process");

      // Store the active tab ID when starting to comment
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs.length > 0) {
          activeTabId = tabs[0].id;
          console.log("Stored starting tab ID:", activeTabId);
        }
      });

      // Initialize commenting state with user inputs
      commentingState = {
        isCommenting: true,
        posts: request.posts,
        currentIndex: 0,
        comment: request.comment || "",
        comments: request.comments || [],
        commentIndex: 0,
        multiCommentMode: request.multiCommentMode || false,
        delay: request.delay,
        randomize: request.randomize,
        skippedPosts: 0,
        usedCommentIndices: [],
        debugMode: request.debugMode || false,
        consecutiveFailures: 0,
        isPaused: false,
      };

      if (commentingState.debugMode) {
        console.log(
          "[DEBUG MODE ACTIVE] Starting comment process with settings:",
          commentingState
        );
      }

      saveState();

      // Start the process in the background
      processNextPost();

      sendResponse({ success: true });
      return true;

    case "stopCommenting":
      console.log("Stopping commenting process");
      commentingState.isCommenting = false;
      saveState();
      sendResponse({ success: true });
      return true;

    case "resumeCommenting":
      resumeCommenting();
      sendResponse({ success: true });
      return true;

    case "getCommentingState":
      console.log("Returning current state to popup");
      loadState().then((state) => {
        sendResponse(state);
      });
      return true;

    case "getCommentHistory":
      console.log("Returning comment history to popup");
      loadCommentHistory().then((history) => {
        sendResponse(history);
      });
      return true;

    case "clearCommentHistory":
      console.log("Clearing comment history");
      commentHistory = {
        successfulUrls: [],
        failedUrls: [],
        skippedUrls: [],
      };
      saveCommentHistory().then(() => {
        sendResponse({ success: true });
      });
      return true;
  }
});

// Handle extension installation or update
chrome.runtime.onInstalled.addListener(() => {
  console.log("Facebook Auto Commenter installed or updated");
  resetState();

  // Initialize comment history
  chrome.storage.local.get(["commentHistory"], (result) => {
    if (!result.commentHistory) {
      commentHistory = {
        successfulUrls: [],
        failedUrls: [],
        skippedUrls: [],
      };
      saveCommentHistory();
    }
  });
});

// Ensure extension remains active
chrome.runtime.onStartup.addListener(() => {
  console.log("Extension started up");
  loadState();
  loadCommentHistory();
});

// Handle tab removal to reset activeTabId if needed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === activeTabId) {
    console.log(`Active tab ${tabId} was closed, resetting activeTabId`);
    activeTabId = null;

    // If we were in the middle of processing, this could cause issues
    // so we'll release the processing lock
    if (isTabProcessing) {
      isTabProcessing = false;
    }
  }
});
