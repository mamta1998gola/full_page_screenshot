// background.js
chrome.action.onClicked.addListener(async (tab) => {
    try {
        // Inject content script to get page dimensions
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            function: getPageDimensions
        });
        
        // We don't need to do anything with the results here, as the content script
        // will communicate back via messages
    } catch (error) {
        console.error("Error executing script:", error);
    }
});

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "dimensions") {
        // Start the capture process with the received dimensions
        handleCapture(sender.tab.id, message.dimensions);
    } else if (message.type === "captureRequest") {
        chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
            sendResponse({ dataUrl: dataUrl });
        });
        return true; // Indicates we'll respond asynchronously
    } else if (message.type === "downloadRequest") {
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        chrome.downloads.download({
            url: message.dataUrl,
            filename: `full-page-screenshot-${timestamp}.png`,
            saveAs: true
        });
    }
});

// This function handles the screenshot capture process from the background script
async function handleCapture(tabId, dimensions) {
    const { width, height, originalScrollPos } = dimensions;
    const viewportHeight = dimensions.viewportHeight;
    
    // Create a data structure to store screenshots
    const screenshots = [];
    
    // Calculate number of full screenshots needed
    const numFullScreenshots = Math.ceil(height / viewportHeight);
    
    // Capture each section
    for (let i = 0; i < numFullScreenshots; i++) {
        // Tell content script to scroll to position
        const scrollTo = i * viewportHeight;
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            function: (scrollPosition) => {
                window.scrollTo(0, scrollPosition);
            },
            args: [scrollTo]
        });
        
        // Small delay to ensure page renders after scroll
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Capture current viewport
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
        screenshots.push({
            dataUrl,
            yPosition: Math.min(i * viewportHeight, height - viewportHeight)
        });
    }
    
    // Restore original scroll position
    await chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: (scrollPosition) => {
            window.scrollTo(0, scrollPosition);
        },
        args: [originalScrollPos]
    });
    
    // Inject a script to create a canvas and combine all screenshots
    await chrome.scripting.executeScript({
        target: { tabId: tabId },
        function: combineScreenshots,
        args: [screenshots, width, height]
    });
}

// This is injected into the page to get dimensions
function getPageDimensions() {
    // Get total height and width of page
    const totalHeight = Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.clientHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight
    );

    const totalWidth = Math.max(
        document.body.scrollWidth,
        document.body.offsetWidth,
        document.documentElement.clientWidth,
        document.documentElement.scrollWidth,
        document.documentElement.offsetWidth
    );

    const originalScrollPos = window.scrollY;
    const viewportHeight = window.innerHeight;

    // Send dimensions back to background script
    chrome.runtime.sendMessage({
        type: "dimensions",
        dimensions: { 
            width: totalWidth, 
            height: totalHeight, 
            originalScrollPos: originalScrollPos,
            viewportHeight: viewportHeight
        }
    });
}

// This function will be injected to combine screenshots
function combineScreenshots(screenshots, width, height) {
    // Create canvas for full page
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    
    // Process each screenshot
    const processScreenshots = async () => {
        for (const screenshot of screenshots) {
            // Load the image
            await new Promise((resolve) => {
                const img = new Image();
                img.onload = () => {
                    ctx.drawImage(img, 0, screenshot.yPosition);
                    resolve();
                };
                img.src = screenshot.dataUrl;
            });
        }
        
        // Get the final image data
        const fullPageDataUrl = canvas.toDataURL('image/png');
        
        // Send it to background script for download
        chrome.runtime.sendMessage({
            type: "downloadRequest",
            dataUrl: fullPageDataUrl
        });
    };
    
    processScreenshots();
}

// content.js is not needed in this approach as we're using executeScript