import puppeteer from 'puppeteer';

/**
 * Gets AWS WAF token from UW-Madison enrollment site
 * This token is required for API requests to work
 * Token expires after ~4 days
 */
async function getWAFToken() {
    console.log('🔐 Getting AWS WAF token...');
    
    const browser = await puppeteer.launch({ 
        headless: true, // Run in headless mode for CI/CD
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    try {
        const page = await browser.newPage();
        
        // Set realistic browser settings
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('📡 Navigating to UW-Madison enrollment site...');
        await page.goto('https://public.enroll.wisc.edu/search', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Wait for token to be generated (usually happens automatically)
        console.log('⏳ Waiting for token generation...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Get cookies
        const cookies = await page.cookies();
        const wafToken = cookies.find(c => c.name === 'aws-waf-token');
        
        if (!wafToken) {
            // Wait a bit more and try again
            console.log('⏳ Token not found, waiting longer...');
            await new Promise(resolve => setTimeout(resolve, 10000));
            
            const cookiesAfter = await page.cookies();
            const wafTokenAfter = cookiesAfter.find(c => c.name === 'aws-waf-token');
            
            if (!wafTokenAfter) {
                throw new Error('Failed to get AWS WAF token. Challenge may require manual intervention.');
            }
            
            console.log('✅ Token found!');
            return wafTokenAfter.value;
        }
        
        console.log('✅ Token found!');
        console.log(`   Token expires: ${wafToken.expires ? new Date(wafToken.expires * 1000).toISOString() : 'Session cookie'}`);
        
        return wafToken.value;
        
    } catch (error) {
        console.error('❌ Error getting WAF token:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// If run directly, output token
if (import.meta.url === `file://${process.argv[1]}`) {
    getWAFToken()
        .then(token => {
            console.log('\n🎉 Token generated successfully!');
            console.log('\nToken:', token);
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Failed to generate token:', error.message);
            process.exit(1);
        });
}

export default getWAFToken;

