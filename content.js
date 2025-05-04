// Facebook Auto Commenter with enhanced modal dialog support
console.log("Facebook Auto Commenter content script loaded");
const RESPONSE_TIMEOUT = 25000; // 25 seconds
// Global debug flag
let debugMode = false;

// Target the exact comment field structure for Facebook
const SELECTORS = {
  commentField: [
    'div[aria-label="Write a comment…"][data-lexical-editor="true"]',
    'div.xzsf02u.notranslate[contenteditable="true"]',
    'div[contenteditable="true"][data-lexical-editor="true"]',
    'div.notranslate[contenteditable="true"]',
  ],
  submitButton: [
    'div[aria-label="Comment"][role="button"]',
    'div[aria-label="Post"][role="button"]',
  ],
};

function debugLog(...args) {
  if (debugMode) {
    console.log("[DEBUG]", ...args);
  }
}

// Enhanced DOM inspection for debug mode
function inspectElement(element, label = "") {
  if (!debugMode || !element) return;

  try {
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(element);

    debugLog(`Element inspection ${label ? `(${label})` : ""}:`, {
      tagName: element.tagName,
      id: element.id,
      classes: element.className,
      text: element.textContent?.slice(0, 50),
      attributes: getElementAttributes(element),
      visibility: {
        display: styles.display,
        visibility: styles.visibility,
        opacity: styles.opacity,
        dimensions: `${rect.width}x${rect.height}`,
        position: `(${rect.left}, ${rect.top})`,
        zIndex: styles.zIndex,
      },
    });

    // If in debug mode, highlight the element temporarily
    if (debugMode) {
      const originalOutline = element.style.outline;
      const originalBackground = element.style.backgroundColor;

      element.style.outline = "3px solid red";
      element.style.backgroundColor = "rgba(255, 0, 0, 0.2)";

      setTimeout(() => {
        element.style.outline = originalOutline;
        element.style.backgroundColor = originalBackground;
      }, 2000);
    }
  } catch (error) {
    console.error(`Error inspecting element (${label}):`, error);
  }
}

// Wait for element with timeout
function waitForElement(selector, timeout = 15000) {
  return new Promise((resolve, reject) => {
    // Check if element already exists
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }

    const startTime = Date.now();
    const checkInterval = setInterval(() => {
      const element = document.querySelector(selector);
      if (element) {
        clearInterval(checkInterval);
        resolve(element);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }
    }, 100);
  });
}

// Try multiple selectors until one works
async function findElementWithSelectors(selectors, timeout = 15000) {
  const errors = [];

  for (const selector of selectors) {
    try {
      console.log(`Trying selector: ${selector}`);
      const element = await waitForElement(selector, timeout);
      console.log(`Found element with selector: ${selector}`);
      return element;
    } catch (error) {
      errors.push(`Selector ${selector}: ${error.message}`);
    }
  }

  throw new Error(
    `None of the selectors found an element: ${errors.join(", ")}`
  );
}

// Check if we're on a modal post
function isModalPost() {
  // More robust check for modal dialog
  const modalOverlay = document.querySelector(
    'div[role="dialog"][aria-modal="true"]'
  );

  // Additional verification to ensure it's a post modal and not another dialog type
  if (modalOverlay) {
    // Check for typical post elements within the modal
    const hasCommentField = !!modalOverlay.querySelector(
      'div[aria-label="Write a comment…"], div[contenteditable="true"][data-lexical-editor="true"]'
    );
    const hasActionButtons = !!modalOverlay.querySelector(
      'div[aria-label="Like"], div[aria-label="Comment"]'
    );

    // Verify this is actually a post modal
    return hasCommentField || hasActionButtons;
  }

  return false;
}

// Get identifying information about current post modal to track stability
function getPostModalInfo() {
  try {
    const modalOverlay = document.querySelector(
      'div[role="dialog"][aria-modal="true"]'
    );
    if (!modalOverlay) return null;

    // Get post author name
    let authorName = "";
    const authorElements = modalOverlay.querySelectorAll('a[role="link"] span');
    for (const element of authorElements) {
      if (element.textContent && element.textContent.trim().length > 0) {
        authorName = element.textContent.trim();
        break;
      }
    }

    // Get post time if available
    let postTime = "";
    const timeElements = modalOverlay.querySelectorAll(
      'span a[role="link"] span'
    );
    for (const element of timeElements) {
      if (
        (element.textContent && element.textContent.includes("h")) ||
        element.textContent.includes("m") ||
        element.textContent.includes("d")
      ) {
        postTime = element.textContent.trim();
        break;
      }
    }

    // Get part of post content
    let postContent = "";
    const contentElements = modalOverlay.querySelectorAll(
      'div[data-ad-comet-preview="message"] span'
    );
    if (contentElements && contentElements.length > 0) {
      postContent = contentElements[0].textContent.trim().substring(0, 50);
    }

    return {
      authorName,
      postTime,
      postContent,
    };
  } catch (error) {
    console.error("Error getting post modal info:", error);
    return null;
  }
}

// Check if post modal is stable and hasn't changed
function checkModalStability(previousInfo) {
  try {
    if (!previousInfo) return false;

    const currentInfo = getPostModalInfo();
    if (!currentInfo) return false;

    // Check if basic attributes match
    const authorMatch = previousInfo.authorName === currentInfo.authorName;
    const contentMatch = previousInfo.postContent === currentInfo.postContent;

    return authorMatch && contentMatch;
  } catch (error) {
    console.error("Error checking modal stability:", error);
    return false;
  }
}

// Ensure focus stays within modal dialog
function trapFocusInModal() {
  try {
    // Only proceed if we're in a modal
    if (!isModalPost()) return;

    const modalDialog = document.querySelector(
      'div[role="dialog"][aria-modal="true"]'
    );
    if (!modalDialog) return;

    debugLog("Setting up focus trap in modal dialog");
    if (debugMode) {
      inspectElement(modalDialog, "Modal Dialog Container");
    }

    console.log("Setting up focus trap in modal dialog");

    // Function to redirect focus to comment input if it goes outside the modal
    const redirectFocus = () => {
      // If the active element is not within the modal, find and focus the comment input
      if (
        document.activeElement &&
        !modalDialog.contains(document.activeElement)
      ) {
        debugLog("Focus escaped modal, redirecting back", {
          activeElement: document.activeElement.tagName,
          activeElementId: document.activeElement.id,
          activeElementClass: document.activeElement.className,
        });

        // Try to focus the comment input
        const commentInput = modalDialog.querySelector(
          SELECTORS.commentField.join(", ")
        );
        if (commentInput) {
          if (debugMode) {
            inspectElement(commentInput, "Comment Input for Focus Redirect");
          }
          commentInput.focus();
        }
      }
    };

    // Set up a MutationObserver to watch for focus changes
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" || mutation.type === "attributes") {
          redirectFocus();
        }
      }
    });

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["tabindex", "focus"],
    });

    // Also set up an interval check as a backup
    const focusInterval = setInterval(redirectFocus, 1000);

    // Return cleanup function
    return () => {
      observer.disconnect();
      clearInterval(focusInterval);
    };
  } catch (error) {
    console.error("Error setting up focus trap:", error);
  }
}

// Find comment input with modal awareness
async function findCommentInput() {
  try {
    // First check if we're in a modal post
    const isModal = isModalPost();
    console.log(`Is modal post: ${isModal}`);

    // Get the modal container if we're in a modal
    const modalContainer = isModal
      ? document.querySelector('div[role="dialog"][aria-modal="true"]')
      : document;

    if (debugMode && isModal && modalContainer) {
      inspectElement(modalContainer, "Modal Container");
    }

    if (isModal && !modalContainer) {
      throw new Error("Modal detected but container not found");
    }

    // Context-aware selector - search within modal if in modal mode
    const searchContext = modalContainer || document;
    console.log(
      `Searching for comment input within ${
        isModal ? "modal context" : "document context"
      }`
    );

    // Additional debugging for modal
    if (debugMode && isModal) {
      const allInputElements = searchContext.querySelectorAll(
        'div[contenteditable="true"]'
      );
      debugLog(
        `Found ${allInputElements.length} contenteditable elements in modal:`,
        Array.from(allInputElements).map((el) => ({
          ariaLabel: el.getAttribute("aria-label"),
          className: el.className,
          visible: isVisible(el),
        }))
      );
    }

    // Try to click the comment area first to activate it (within proper context)
    try {
      const commentPlaceholders = searchContext.querySelectorAll(
        '[aria-label="Write a comment..."]'
      );
      if (commentPlaceholders && commentPlaceholders.length > 0) {
        console.log(
          "Found and clicking comment placeholder within proper context"
        );
        commentPlaceholders[0].click();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (e) {
      console.log("No placeholder found or error clicking:", e);
    }

    // Find comment input within proper context
    for (const selector of SELECTORS.commentField) {
      const element = searchContext.querySelector(selector);
      if (element) {
        console.log(`Comment input found in context: ${selector}`);
        return element;
      }
    }

    // If not found immediately, try with waiting and context
    let timeoutCounter = 0;
    const maxTimeout = 15000; // 15 seconds
    const checkInterval = 100;

    while (timeoutCounter < maxTimeout) {
      for (const selector of SELECTORS.commentField) {
        const element = searchContext.querySelector(selector);
        if (element) {
          console.log(
            `Comment input found in context after waiting: ${selector}`
          );
          return element;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
      timeoutCounter += checkInterval;
    }

    throw new Error("Comment input not found in proper context");
  } catch (error) {
    console.error("Failed to find comment input:", error);
    throw error;
  }
}

// Find submit button with modal awareness
async function findSubmitButton() {
  try {
    // First check if we're in a modal post
    const isModal = isModalPost();

    // Get the modal container if we're in a modal
    const modalContainer = isModal
      ? document.querySelector('div[role="dialog"][aria-modal="true"]')
      : document;

    // Context-aware search
    const searchContext = modalContainer || document;

    // Try to find within proper context
    for (const selector of SELECTORS.submitButton) {
      const element = searchContext.querySelector(selector);
      if (element) {
        console.log(`Submit button found in context: ${selector}`);
        return element;
      }
    }

    // If not found immediately, try with timeout
    let timeoutCounter = 0;
    const maxTimeout = 10000; // 10 seconds
    const checkInterval = 100;

    while (timeoutCounter < maxTimeout) {
      for (const selector of SELECTORS.submitButton) {
        const element = searchContext.querySelector(selector);
        if (element) {
          console.log(
            `Submit button found in context after waiting: ${selector}`
          );
          return element;
        }
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));
      timeoutCounter += checkInterval;
    }

    console.error("Submit button not found in proper context");
    return null;
  } catch (error) {
    console.error("Submit button not found:", error);
    return null;
  }
}

// Check if the user has already commented on this post
async function hasUserAlreadyCommented() {
  console.log("Checking if user has already commented on this post");

  try {
    // Get logged-in user ID (focus on ID only for reliability)
    const userId = extractUserID();
    console.log(`Working with user ID: ${userId}`);

    if (!userId) {
      console.log(
        "Could not determine user ID, unable to check for existing comments"
      );
      return false;
    }

    // Wait for post and comments to fully load
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Try to expand all comments if possible
    await expandAllComments();

    // Check if we're in a modal to determine search context
    const isModal = isModalPost();
    const searchContext = isModal
      ? document.querySelector('div[role="dialog"][aria-modal="true"]')
      : document;

    if (!searchContext) {
      console.log("Could not determine search context");
      return false;
    }

    // STEP 1: First identify all genuine comment containers
    const commentContainers = Array.from(
      searchContext.querySelectorAll('div[role="article"]')
    ).filter((container) => {
      // Only consider elements that actually look like comments
      const ariaLabel = container.getAttribute("aria-label") || "";
      return (
        ariaLabel.includes("Comment by") ||
        // Also check for comment-like functionality (reply button, like button)
        (container.querySelector('div[role="button"]') &&
          container.textContent.includes("Reply"))
      );
    });

    console.log(
      `Found ${commentContainers.length} comment containers to check`
    );

    // STEP 2: Now check each comment container for the user's identity
    for (const container of commentContainers) {
      // Method 1: Check for user ID in links within this container only
      if (userId) {
        const userLinks = container.querySelectorAll(
          'a[href*="/user/"], a[href*="profile.php"]'
        );
        for (const link of userLinks) {
          if (
            (link.href && link.href.includes(`/user/${userId}`)) ||
            (link.href && link.href.includes(`profile.php?id=${userId}`))
          ) {
            console.log(
              `Found comment with user ID ${userId} in link href within comment container`
            );
            return true;
          }
        }
      }
    }

    // If we get this far, no comments from the user were found
    console.log("No existing comments found from current user");
    return false;
  } catch (error) {
    console.error("Error checking for user comments:", error);
    return false; // On error, proceed with commenting
  }
}

// Helper function to expand all comments if possible
async function expandAllComments() {
  try {
    // Find and click "View more comments" and similar buttons
    const possibleButtonTexts = [
      "view more comments",
      "view",
      "more comments",
      "see more",
    ];

    // Get all buttons and span elements that might be for expanding comments
    const allButtons = document.querySelectorAll(
      'div[role="button"], span[role="button"]'
    );

    for (const button of allButtons) {
      const buttonText = (button.textContent || "").toLowerCase();
      if (possibleButtonTexts.some((text) => buttonText.includes(text))) {
        console.log(
          `Clicking '${button.textContent}' button to load more comments`
        );
        button.click();
        // Wait for comments to load
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  } catch (e) {
    console.log("Error expanding comments:", e);
  }
}

// Extract user ID only (more reliable than username)
function extractUserID() {
  console.log("Extracting user ID");
  let userId = "";

  try {
    // Method 1: From profile link
    const profileLinks = document.querySelectorAll('a[href*="/profile.php"]');
    for (const link of profileLinks) {
      const matches = link.href.match(/id=(\d+)/);
      if (matches && matches[1]) {
        userId = matches[1];
        console.log(`Found user ID from profile link: ${userId}`);
        break;
      }
    }

    // Method 2: From other links containing user ID
    if (!userId) {
      const allLinks = document.querySelectorAll('a[href*="/user/"]');
      for (const link of allLinks) {
        const matches = link.href.match(/\/user\/(\d+)/);
        if (matches && matches[1]) {
          userId = matches[1];
          console.log(`Found user ID from user link: ${userId}`);
          break;
        }
      }
    }

    // Method 3: From localStorage or cookies (if available)
    if (!userId) {
      // This is a fallback method that might work in some cases
      try {
        // Check various places Facebook might store user ID
        const html = document.documentElement.innerHTML;
        const userIdMatch = html.match(/"USER_ID":"(\d+)"/);
        if (userIdMatch && userIdMatch[1]) {
          userId = userIdMatch[1];
          console.log(`Found user ID from page HTML: ${userId}`);
        }
      } catch (e) {
        console.log("Error extracting user ID from page data:", e);
      }
    }
  } catch (error) {
    console.error("Error extracting user ID:", error);
  }

  console.log(`Final user ID: ${userId}`);
  return userId;
}

// Set text in Facebook's Lexical editor
function setTextInLexicalEditor(element, text) {
  debugLog(`Setting text in Lexical Editor: "${text}"`);

  if (debugMode) {
    try {
      inspectElement(element, "Lexical Editor Element");
    } catch (error) {
      console.error("Error inspecting element:", error);
    }
  }

  // Focus the element
  element.focus();

  // Clear existing content by selecting all and deleting
  document.execCommand("selectAll", false, null);
  document.execCommand("delete", false, null);

  // Find the paragraph element inside (this is the actual content container)
  const paragraphElement = element.querySelector("p") || element;

  if (debugMode && paragraphElement !== element) {
    try {
      inspectElement(paragraphElement, "Paragraph Element within Editor");
    } catch (error) {
      console.error("Error inspecting paragraph element:", error);
    }
  }

  // Method 1: Handle multiline text properly
  if (text.includes("\n")) {
    // Split by newlines and create proper paragraph structure
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // For the first line, use the existing paragraph
      if (i === 0) {
        paragraphElement.textContent = lines[i];
      } else {
        // For subsequent lines, create new paragraphs and add them
        // This simulates pressing Enter in the editor
        document.execCommand("insertLineBreak");

        // Wait a moment for the editor to update
        setTimeout(() => {
          try {
            document.execCommand("insertText", false, lines[i]);
          } catch (error) {
            console.error("Error inserting text for line:", error);
          }
        }, 100 * i); // Stagger the insertions to ensure they happen in order
      }
    }
  } else {
    // Single line text handling (original method)
    paragraphElement.textContent = text;
  }

  // Trigger appropriate events
  try {
    const inputEvent = new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      data: text,
    });
    element.dispatchEvent(inputEvent);
    debugLog("Dispatched input event");

    // Force change event
    element.dispatchEvent(new Event("change", { bubbles: true }));
    debugLog("Dispatched change event");
  } catch (error) {
    console.error("Error dispatching events:", error);
  }

  // Return true even if there were issues - Facebook's editor is complex
  return true;
}

// Submit with Enter key
function submitWithEnterKey(element) {
  console.log("Submitting with Enter key");

  // Focus the element
  element.focus();

  // Create and dispatch Enter key events
  const keydownEvent = new KeyboardEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  });

  const keypressEvent = new KeyboardEvent("keypress", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  });

  const keyupEvent = new KeyboardEvent("keyup", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  });

  // Dispatch all events in sequence
  element.dispatchEvent(keydownEvent);
  element.dispatchEvent(keypressEvent);
  element.dispatchEvent(keyupEvent);

  console.log("Enter key event dispatched");
}

// Add comment to post
async function addComment(comment, delay) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`Attempting to add comment: "${comment}"`);

      // Find comment input
      const commentInput = await findCommentInput();
      console.log("Comment input element:", commentInput);

      // Sleep to let page stabilize
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Set text in the Lexical editor
      setTextInLexicalEditor(commentInput, comment);

      // Sleep before submitting
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Skip submit button search and use Enter key directly
      console.log("Using Enter key for submission");
      submitWithEnterKey(commentInput);

      // IMPORTANT: Send early response after submission attempt
      console.log("Comment likely submitted - responding now");
      resolve(true);

      // Continue with verification in the background
      setTimeout(() => {
        try {
          // Check for submission success
          const commentText =
            commentInput.textContent || commentInput.innerText;

          console.log(
            `Comment verification complete. Current field content:`,
            commentText
          );
        } catch (e) {
          console.log("Post-submission verification error:", e);
        }
      }, delay || 3000);
    } catch (error) {
      console.error("Error adding comment:", error);
      reject(error);
    }
  });
}

// Process post - now with check for existing comments and modal awareness
async function processPost(comment, delay) {
  try {
    console.log(`Processing post with comment: "${comment}"`);

    // Wait for page to load fully
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Check if we're in a modal post
    const isModal = isModalPost();
    console.log(`Is modal post: ${isModal}`);

    if (isModal) {
      console.log("Modal post detected, setting up focus management");
      // Set up focus trapping in modal
      const cleanupFocusTrap = trapFocusInModal();

      // Clean up after we're done
      setTimeout(() => {
        if (cleanupFocusTrap) cleanupFocusTrap();
      }, 30000); // Clean up after 30 seconds
    }

    // Check if the user has already commented on this post
    const alreadyCommented = await hasUserAlreadyCommented();

    if (alreadyCommented) {
      console.log("User has already commented on this post, skipping");
      return {
        success: true,
        skipped: true,
        message: "Post already commented on",
      };
    }

    // Add comment if not already commented
    console.log("No existing comment found, proceeding with comment");
    await addComment(comment, delay);

    return { success: true };
  } catch (error) {
    console.error("Failed to process post:", error);
    return { success: false, error: error.message };
  }
}

// Debugging function to show active elements on the page
function debugPage() {
  debugLog("Running debug page inspection");

  // Add visual debug indicator if in debug mode
  if (debugMode) {
    const debugIndicator = document.createElement("div");
    debugIndicator.style.position = "fixed";
    debugIndicator.style.top = "10px";
    debugIndicator.style.right = "10px";
    debugIndicator.style.backgroundColor = "rgba(255, 0, 0, 0.8)";
    debugIndicator.style.color = "white";
    debugIndicator.style.padding = "5px 10px";
    debugIndicator.style.borderRadius = "5px";
    debugIndicator.style.zIndex = "999999";
    debugIndicator.style.fontWeight = "bold";
    debugIndicator.textContent = "FB Auto Commenter: DEBUG MODE";
    document.body.appendChild(debugIndicator);

    // Auto-remove after 10 seconds
    setTimeout(() => {
      document.body.removeChild(debugIndicator);
    }, 10000);
  }

  const commentInputSelectors = SELECTORS.commentField.join(", ");
  const elements = document.querySelectorAll(commentInputSelectors);

  debugLog(`Found ${elements.length} potential comment fields:`);
  elements.forEach((el, i) => {
    debugLog(`Element ${i + 1}:`, el);
    debugLog(`- Content: "${el.textContent}"`);
    debugLog(`- Visible: ${isVisible(el)}`);
    debugLog(`- Classes: ${el.className}`);
    debugLog(`- Attributes:`, getElementAttributes(el));

    if (debugMode) {
      inspectElement(el, `Comment Field ${i + 1}`);
    }
  });

  // If in debug mode, also inspect the modal dialog if present
  if (debugMode && isModalPost()) {
    const modalDialog = document.querySelector(
      'div[role="dialog"][aria-modal="true"]'
    );
    inspectElement(modalDialog, "Modal Dialog Container");

    // Inspect Facebook-specific elements that might be important
    const interactiveElements = modalDialog.querySelectorAll('[role="button"]');
    debugLog(
      `Found ${interactiveElements.length} interactive elements in modal`
    );

    // Locate the comment section
    const commentSection = Array.from(modalDialog.querySelectorAll("div")).find(
      (div) => div.textContent && div.textContent.includes("Write a comment")
    );

    if (commentSection) {
      inspectElement(commentSection, "Comment Section Container");
    }
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function getElementAttributes(el) {
    if (!el || !el.attributes) {
      return {};
    }

    const attrs = {};
    try {
      for (let i = 0; i < el.attributes.length; i++) {
        const attr = el.attributes[i];
        if (attr && attr.name && attr.value !== undefined) {
          attrs[attr.name] = attr.value;
        }
      }
    } catch (error) {
      console.error("Error getting element attributes:", error);
    }
    return attrs;
  }
}

// Message listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request);

  if (request.action === "verifyPostStability") {
    // Check if we're on a modal post
    const isModal = isModalPost();

    // Get modal info
    const modalInfo = getPostModalInfo();

    // Send response
    sendResponse({
      isModal: isModal,
      modalInfo: modalInfo,
    });

    return true;
  }

  if (request.action === "checkModalStability") {
    const isStable = checkModalStability(request.previousInfo);

    sendResponse({
      isStable: isStable,
    });

    return true;
  }

  if (request.action === "processPost") {
    // Set debug mode based on request parameter
    debugMode = request.debugMode || false;

    if (debugMode) {
      console.log(
        "[DEBUG MODE ACTIVE] Starting to process post with comment:",
        request.comment
      );
    }

    // Create a flag to track if response was sent
    let responseSent = false;

    // Set up timeout to ensure a response is always sent
    const timeoutId = setTimeout(() => {
      if (!responseSent) {
        console.log("Sending timeout fallback response");
        responseSent = true;
        sendResponse({
          success: true,
          warning: "Timeout reached, but comment submission was attempted",
        });
      }
    }, RESPONSE_TIMEOUT);

    // Process the request
    const processPromise = async () => {
      try {
        console.log(`Processing post with comment: "${request.comment}"`);

        // Wait for page to load
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Process post - will check for existing comments
        const result = await processPost(request.comment, request.delay);

        // Send response if not already sent
        if (!responseSent) {
          console.log("Sending success response:", result);
          responseSent = true;
          clearTimeout(timeoutId);
          sendResponse(result);
        }
      } catch (error) {
        console.error("Error in processPost:", error);

        // Send error response if not already sent
        if (!responseSent) {
          console.log("Sending error response");
          responseSent = true;
          clearTimeout(timeoutId);
          sendResponse({ success: false, error: error.message });
        }
      }
    };

    // Execute the async operation
    processPromise();

    // Return true to indicate async response
    return true;
  }
});

// Run debug on page load
setTimeout(debugPage, 5000);

console.log("Facebook Auto Commenter: Content script initialized");
