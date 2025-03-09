// background.js
let currentTab = null;
let screenshots = [];
let dimensions = null;

// Listen for browser action click
chrome.action.onClicked.addListener((tab) => {
    currentTab = tab;
    screenshots = [];
    
    console.log("Extension clicked on tab:", tab.id);
    
    // Step 1: Inject the content script to measure the page
    chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: measurePage
    }).then(() => {
        console.log("Page measurement script injected");
    }).catch(error => {
        console.error("Failed to inject measurement script:", error);
    });
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Received message in background:", message.type);
    
    if (message.type === "dimensions") {
        dimensions = message.dimensions;
        console.log("Received page dimensions:", dimensions);
        
        // Step 2: Start the screenshot process
        beginCapture();
        return true;
    } else if (message.type === "downloadImage") {
        // Step 4: Handle the download request
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        chrome.downloads.download({
            url: message.dataUrl,
            filename: `full-page-screenshot-${timestamp}.png`,
            saveAs: true
        });
        return true;
    }
});

// Start the capture process
function beginCapture() {
    if (!currentTab || !dimensions) {
        console.error("Missing tab or dimensions");
        return;
    }
    
    screenshots = [];
    console.log("Beginning capture process");
    
    // Step 3: Capture the first viewport and continue
    captureCurrentViewport(0);
}

// Capture the current viewport and continue if needed
function captureCurrentViewport(scrollIndex) {
    if (!currentTab || !dimensions) return;
    
    const { height, viewportHeight } = dimensions;
    const scrollStep = Math.floor(viewportHeight * 0.9);
    const totalScrolls = Math.ceil(height / scrollStep);
    const currentScrollPos = scrollIndex * scrollStep;
    
    console.log(`Capturing viewport ${scrollIndex + 1}/${totalScrolls} at scroll position ${currentScrollPos}`);
    
    // First scroll to the position
    chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        function: scrollToPosition,
        args: [currentScrollPos]
    }).then(() => {
        console.log("Scrolled to position:", currentScrollPos);
        
        // Give the page time to render after scrolling
        setTimeout(() => {
            // Then capture the visible part
            chrome.tabs.captureVisibleTab(null, { format: "png" }).then(dataUrl => {
                console.log("Captured viewport at scroll position:", currentScrollPos);
                
                screenshots.push({
                    dataUrl: dataUrl,
                    scrollY: currentScrollPos
                });
                
                // Determine if we need to capture more
                if (scrollIndex < totalScrolls - 1 && currentScrollPos + scrollStep < height) {
                    // Capture the next viewport
                    captureCurrentViewport(scrollIndex + 1);
                } else {
                    // We're done capturing, process the images
                    console.log(`Capture complete, got ${screenshots.length} screenshots`);
                    processScreenshots();
                }
            }).catch(error => {
                console.error("Failed to capture viewport:", error);
            });
        }, 500); // Wait 500ms for the page to render
    }).catch(error => {
        console.error("Failed to scroll to position:", error);
    });
}

// Process all captured screenshots
function processScreenshots() {
    if (!currentTab || screenshots.length === 0) {
        console.error("No screenshots to process");
        return;
    }
    
    console.log("Processing screenshots, injecting processing script");
    
    // Inject the processing script and pass the screenshots
    chrome.scripting.executeScript({
        target: { tabId: currentTab.id },
        function: processImages,
        args: [screenshots, dimensions]
    }).catch(error => {
        console.error("Failed to process screenshots:", error);
    });
}

// Function to scroll to specific position (runs in content script)
function scrollToPosition(position) {
    return new Promise((resolve) => {
        // Use multiple scroll methods for compatibility
        window.scrollTo(0, position);
        document.documentElement.scrollTop = position;
        document.body.scrollTop = position;
        
        setTimeout(resolve, 200);
    });
}

// Function to measure the page (runs in content script)
function measurePage() {
    console.log("Measuring page dimensions");
    
    // Get page dimensions
    const totalHeight = Math.max(
        document.body.scrollHeight,
        document.body.offsetHeight,
        document.documentElement.scrollHeight,
        document.documentElement.offsetHeight,
        document.querySelector('html')?.scrollHeight || 0
    );

    const totalWidth = Math.max(
        document.body.scrollWidth,
        document.body.offsetWidth,
        document.documentElement.scrollWidth,
        document.documentElement.offsetWidth,
        document.querySelector('html')?.scrollWidth || 0
    );

    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const originalScrollPos = window.scrollY;

    console.log(`Page dimensions: ${totalWidth}x${totalHeight}`);
    console.log(`Viewport dimensions: ${viewportWidth}x${viewportHeight}`);

    // Send dimensions back to background
    chrome.runtime.sendMessage({
        type: "dimensions",
        dimensions: { 
            width: totalWidth, 
            height: totalHeight, 
            originalScrollPos: originalScrollPos,
            viewportHeight: viewportHeight,
            viewportWidth: viewportWidth
        }
    });
}

// Function to process captured images (runs in content script)
function processImages(screenshots, dimensions) {
    console.log(`Processing ${screenshots.length} screenshots for a ${dimensions.width}x${dimensions.height} page`);
    
    // Create a canvas element
    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    
    const ctx = canvas.getContext('2d');
    
    // Fill with white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);
    
    // Function to load an image from data URL
    const loadImage = (dataUrl) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => {
                console.error("Failed to load image");
                resolve(null);
            };
            img.src = dataUrl;
        });
    };
    
    // Draw each screenshot onto the canvas
    const drawImages = async () => {
        for (let i = 0; i < screenshots.length; i++) {
            const screenshot = screenshots[i];
            const img = await loadImage(screenshot.dataUrl);
            
            if (img) {
                console.log(`Drawing screenshot ${i+1} at position ${screenshot.scrollY}`);
                ctx.drawImage(img, 0, screenshot.scrollY);
            }
        }
        
        // Convert to data URL and send for download
        const finalDataUrl = canvas.toDataURL('image/png');
        
        console.log("Final image created, sending to background for download");
        chrome.runtime.sendMessage({
            type: "downloadImage",
            dataUrl: finalDataUrl
        });
    };
    
    // Start the drawing process
    drawImages().catch(error => {
        console.error("Error drawing images:", error);
    });
}