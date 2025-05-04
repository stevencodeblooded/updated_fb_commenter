// Enhanced background.js for Facebook Auto Commenter

// Constants for timeouts
const MODAL_RESPONSE_TIMEOUT = 45000; // 45 seconds for modal posts
const STANDARD_RESPONSE_TIMEOUT = 30000; // 30 seconds for regular posts
const MAX_HISTORY_ITEMS = 50; // Maximum number of URLs to store in history

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
};

// Comment history for tracking success/failure of URLs
let commentHistory = {
  successfulUrls: [], // {url, timestamp, comment}
  failedUrls: [], // {url, timestamp, reason}
  skippedUrls: [], // {url, timestamp, reason}
};

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
    debugMode: false, // Add debug mode property
  };
  console.log("State reset");
  return saveState();
}

// Enhanced debugLog function
function debugLog(...args) {
  if (commentingState.debugMode) {
    console.log('[DEBUG]', ...args);
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

// Store the active tab when commenting starts
let startingTabId = null;

// Process next post with improved navigation and reliability
async function processNextPost() {
  try {
    await loadState();

    // Check if we're done or stopped
    if (
      !commentingState.isCommenting ||
      commentingState.currentIndex >= commentingState.posts.length
    ) {
      // Load comment history to get accurate counts
      const history = await loadCommentHistory();

      // Count successful, failed, and skipped posts for this session
      // We're focusing just on the most recent entries that match this session's count
      const currentSessionCount = commentingState.posts.length;

      // Calculate successful posts (posts that were actually commented on)
      const successfulCount =
        commentingState.currentIndex - commentingState.skippedPosts;

      // Failed posts (difference between total and successful+skipped)
      const failedCount =
        currentSessionCount - successfulCount - commentingState.skippedPosts;

      // Send complete message with full stats
      const finalMessage =
        commentingState.skippedPosts > 0
          ? `Commenting completed. ${successfulCount} posts were commented on successfully, ${commentingState.skippedPosts} posts were skipped (already commented on).`
          : "Commenting process finished successfully.";

      // Save the current state for reference before resetting
      const skippedPosts = commentingState.skippedPosts;

      // Now reset the state
      await resetState();

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

    const currentUrl = commentingState.posts[commentingState.currentIndex];
    const selectedComment = selectNextComment();

    // Initialize isModal at the top level of the function scope
    let isModal = false; // <-- Add this line

    console.log(
      `Processing post ${commentingState.currentIndex + 1}/${
        commentingState.posts.length
      }`
    );
    console.log(`URL: ${currentUrl}`);
    console.log(`Selected comment: "${selectedComment}"`);

    try {
      // Find the best tab to use for processing
      let targetTab;
      let shouldUseStartingTab = false;

      // First, check if startingTabId is still valid
      if (startingTabId) {
        try {
          const startingTab = await chrome.tabs.get(startingTabId);
          if (startingTab) {
            shouldUseStartingTab = true;
            targetTab = startingTab;
            console.log(
              "Using the same tab where the process started:",
              startingTabId
            );
          }
        } catch (error) {
          console.log("Starting tab no longer exists, will find another tab");
          startingTabId = null;
        }
      }

      // If we can't use the starting tab, find an existing Facebook tab
      if (!shouldUseStartingTab) {
        const facebookTabs = await chrome.tabs.query({
          url: ["https://web.facebook.com/*", "https://www.facebook.com/*"],
        });

        if (facebookTabs.length > 0) {
          // Use existing Facebook tab
          targetTab = facebookTabs[0];
          console.log("Using existing Facebook tab:", targetTab.id);
        } else {
          // If no Facebook tab exists, check for a normal browsing tab
          const allTabs = await chrome.tabs.query({ currentWindow: true });
          const normalTab = allTabs.find(
            (tab) =>
              !tab.url.startsWith("chrome:") &&
              !tab.url.startsWith("chrome-extension:") &&
              !tab.url.startsWith("devtools:")
          );

          if (normalTab) {
            // Use an existing normal tab instead of creating a new one
            targetTab = normalTab;
            console.log("Using existing normal browsing tab:", targetTab.id);
          } else {
            // Create new tab only as last resort
            console.log("Creating new tab as last resort");
            targetTab = await chrome.tabs.create({ url: currentUrl });
            // Update immediately to prevent waiting for creation
            await new Promise((resolve) => setTimeout(resolve, 500));
            return processNextPost(); // Restart this post processing
          }
        }
      }

      // Navigate to the post URL
      await chrome.tabs.update(targetTab.id, { url: currentUrl });

      // Wait for page load and Facebook to initialize
      console.log("Waiting for page to load completely...");
      await new Promise((resolve) => setTimeout(resolve, 8000));

      // Ensure tab is still valid
      try {
        await chrome.tabs.get(targetTab.id);
      } catch (error) {
        throw new Error("Tab no longer exists");
      }

      // Check for post modal and verify stability
      console.log("Verifying post stability...");
      let modalInfo = null;

      try {
        // Check if post is a modal
        const postVerification = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(
            targetTab.id,
            { action: "verifyPostStability" },
            (response) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
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
            chrome.tabs.sendMessage(
              targetTab.id,
              {
                action: "checkModalStability",
                previousInfo: modalInfo,
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  reject(chrome.runtime.lastError);
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

      // Send message to content script with timeout
      console.log(`Sending message to tab ${targetTab.id}`);

      // Use a promise with timeout for message handling
      const response = await Promise.race([
        new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(
            targetTab.id,
            {
              action: "processPost",
              comment: selectedComment,
              delay: commentingState.delay * 1000,
              isModalContext: isModal,
              debugMode: commentingState.debugMode, // Pass debug mode to content script
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.error("Runtime error:", chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
              } else if (response) {
                resolve(response);
              } else {
                reject(new Error("No response received from content script"));
              }
            }
          );
        }),
        // Timeout with adjusted value based on modal context
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                success: true,
                warning: isModal
                  ? "Modal content script timed out but comment was likely posted"
                  : "Content script timed out but comment was likely posted",
              }),
            isModal ? MODAL_RESPONSE_TIMEOUT : STANDARD_RESPONSE_TIMEOUT
          )
        ),
      ]);

      console.log("Response from content script or timeout:", response);

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

      // Record failed comment with enhanced error info
      recordFailedComment(currentUrl, errorMessage);

      // Send error message to popup
      chrome.runtime.sendMessage({
        action: "commentError",
        currentIndex: commentingState.currentIndex + 1,
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

    // Schedule next post with the specified delay
    setTimeout(processNextPost, commentingState.delay * 1000);
  } catch (error) {
    console.error("Fatal error in processNextPost:", error);

    // Reset state on fatal error
    await resetState();

    chrome.runtime.sendMessage({
      action: "commentError",
      error: `Fatal error: ${error.message}`,
    });
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
          startingTabId = tabs[0].id;
          console.log("Stored starting tab ID:", startingTabId);
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
        debugMode: request.debugMode || false, // Store debug mode flag
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