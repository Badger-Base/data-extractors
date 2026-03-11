import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

async function testWAFChallenge() {
    console.log('🔍 Testing AWS WAF Challenge Detection...\n');
    
    const browser = await puppeteer.launch({ 
        headless: false, // Show browser so we can see what's happening
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    try {
        const page = await browser.newPage();
        
        // Set viewport to match a real browser
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Set realistic user agent
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('📡 Navigating to UW-Madison enrollment site...');
        await page.goto('https://public.enroll.wisc.edu/search', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });
        
        // Wait a bit for any challenges to appear
        console.log('⏳ Waiting 5 seconds for challenge to appear...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Take screenshot to see what's on the page
        const screenshotDir = path.join(process.cwd(), 'test_screenshots');
        if (!fs.existsSync(screenshotDir)) {
            fs.mkdirSync(screenshotDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const screenshotPath = path.join(screenshotDir, `waf-challenge-${timestamp}.png`);
        await page.screenshot({ 
            path: screenshotPath, 
            fullPage: true 
        });
        console.log(`📸 Screenshot saved to: ${screenshotPath}`);
        
        // Check for cookies
        console.log('\n🍪 Checking cookies...');
        const cookies = await page.cookies();
        const cookieNames = cookies.map(c => c.name);
        console.log('Cookie names:', cookieNames);
        
        const wafToken = cookies.find(c => c.name === 'aws-waf-token');
        if (wafToken) {
            console.log('✅ AWS WAF token found!');
            console.log(`   Token value (first 50 chars): ${wafToken.value.substring(0, 50)}...`);
            console.log(`   Expires: ${wafToken.expires ? new Date(wafToken.expires * 1000).toISOString() : 'Session cookie'}`);
        } else {
            console.log('❌ No AWS WAF token found');
        }
        
        // Check for common CAPTCHA/challenge elements
        console.log('\n🔎 Checking for challenge elements...');
        
        const checks = {
            'reCAPTCHA': await page.$('.g-recaptcha, #recaptcha, [data-sitekey]'),
            'hCaptcha': await page.$('.h-captcha, [data-hcaptcha]'),
            'Cloudflare Challenge': await page.$('#challenge-form, .cf-browser-verification'),
            'AWS WAF Challenge': await page.$('[data-aws-waf], .aws-waf-challenge'),
            'Traffic Cone Challenge': await page.$('img[alt*="cone"], img[alt*="traffic"]'),
            'Generic Challenge Button': await page.$('button[type="submit"].challenge, .challenge-button'),
            'Challenge iframe': await page.$('iframe[src*="challenge"], iframe[src*="captcha"]')
        };
        
        let foundChallenge = false;
        for (const [name, element] of Object.entries(checks)) {
            if (element) {
                console.log(`⚠️  Found: ${name}`);
                foundChallenge = true;
            }
        }
        
        if (!foundChallenge) {
            console.log('✅ No visible challenge elements detected');
        }
        
        // Check page title and URL
        const title = await page.title();
        const url = page.url();
        console.log(`\n📄 Page title: ${title}`);
        console.log(`🔗 Current URL: ${url}`);
        
        // Check for error messages
        const errorText = await page.evaluate(() => {
            const errorElements = document.querySelectorAll('.error, .alert, [role="alert"]');
            return Array.from(errorElements).map(el => el.textContent).join(' | ');
        });
        
        if (errorText) {
            console.log(`\n⚠️  Error messages found: ${errorText}`);
        }
        
        // Try to make an API request with the token
        if (wafToken) {
            console.log('\n🧪 Testing API request with token...');
            try {
                const apiUrl = 'https://public.enroll.wisc.edu/api/search/v1/enrollmentPackages/1264/240/003275';
                
                // Get all cookies as a string
                const allCookies = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                
                const response = await page.evaluate(async (url, token, cookies) => {
                    const res = await fetch(url, {
                        method: 'GET',
                        headers: {
                            'x-aws-waf-token': token,
                            'Cookie': cookies,
                            'Accept': 'application/json, text/plain, */*',
                            'Accept-Language': 'en-US,en;q=0.9',
                            'Referer': 'https://public.enroll.wisc.edu/search',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        }
                    });
                    return {
                        status: res.status,
                        contentType: res.headers.get('content-type'),
                        text: await res.text().then(t => t.substring(0, 500))
                    };
                }, apiUrl, wafToken.value, allCookies);
                
                console.log(`   Status: ${response.status}`);
                console.log(`   Content-Type: ${response.contentType}`);
                if (response.status === 200 && response.contentType?.includes('application/json')) {
                    console.log('   ✅ API request successful!');
                    console.log(`   Response preview: ${response.text.substring(0, 200)}`);
                } else {
                    console.log('   ❌ API request failed or returned non-JSON');
                    console.log(`   Response preview: ${response.text.substring(0, 200)}`);
                }
            } catch (error) {
                console.log(`   ❌ Error testing API: ${error.message}`);
            }
        }
        
        // Wait a bit more to see if anything changes
        console.log('\n⏳ Waiting 10 more seconds to see if challenge completes...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        // Check cookies again
        const cookiesAfter = await page.cookies();
        const wafTokenAfter = cookiesAfter.find(c => c.name === 'aws-waf-token');
        
        if (!wafToken && wafTokenAfter) {
            console.log('✅ Token appeared after waiting! Challenge completed automatically.');
        } else if (wafToken && wafTokenAfter) {
            console.log('✅ Token still present');
        } else {
            console.log('❌ Still no token after waiting');
        }
        
        // Final screenshot
        const finalScreenshotPath = path.join(screenshotDir, `waf-final-${timestamp}.png`);
        await page.screenshot({ 
            path: finalScreenshotPath, 
            fullPage: true 
        });
        console.log(`📸 Final screenshot saved to: ${finalScreenshotPath}`);
        
        console.log('\n✅ Test complete! Check the screenshots to see what challenge appeared.');
        
    } catch (error) {
        console.error('\n❌ Error during test:', error);
    } finally {
        // Keep browser open for 5 seconds so user can see
        console.log('\n⏳ Keeping browser open for 5 seconds...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        await browser.close();
    }
}

// Run the test
testWAFChallenge().catch(console.error);

