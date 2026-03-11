import { Octokit } from '@octokit/rest';
import sodium from 'tweetsodium';
import getWAFToken from './get_waf_token.js';

/**
 * Updates GitHub secret with WAF token
 * Requires GITHUB_TOKEN environment variable with repo permissions
 */
async function updateGitHubSecret(token, secretName = 'AWS_WAF_TOKEN') {
    const githubToken = process.env.GITHUB_TOKEN;
    const repoOwner = process.env.GITHUB_REPOSITORY_OWNER || 'Badger-Base';
    const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'data-extractors';
    
    if (!githubToken) {
        throw new Error('GITHUB_TOKEN environment variable is required');
    }
    
    console.log(`📦 Updating GitHub secret: ${secretName}`);
    console.log(`   Repository: ${repoOwner}/${repoName}`);
    
    const octokit = new Octokit({ auth: githubToken });
    
    try {
        // Get the public key for the repository
        const { data: publicKey } = await octokit.rest.actions.getRepoPublicKey({
            owner: repoOwner,
            repo: repoName,
        });
        
        console.log('🔑 Got repository public key');
        
        // Encrypt the token
        const messageBytes = Buffer.from(token);
        const keyBytes = Buffer.from(publicKey.key, 'base64');
        const encryptedBytes = sodium.seal(messageBytes, keyBytes);
        const encryptedValue = Buffer.from(encryptedBytes).toString('base64');
        
        console.log('🔐 Encrypted token');
        
        // Update the secret
        await octokit.rest.actions.createOrUpdateRepoSecret({
            owner: repoOwner,
            repo: repoName,
            secret_name: secretName,
            encrypted_value: encryptedValue,
            key_id: publicKey.key_id,
        });
        
        console.log(`✅ Successfully updated secret: ${secretName}`);
        
    } catch (error) {
        console.error('❌ Error updating GitHub secret:', error.message);
        throw error;
    }
}

/**
 * Main function: Get token and update GitHub secret
 */
async function main() {
    try {
        console.log('🚀 Starting WAF token update process...\n');
        
        // Get the token
        const token = await getWAFToken();
        console.log(`\n📋 Token length: ${token.length} characters`);
        
        // Update GitHub secret
        await updateGitHubSecret(token);
        
        console.log('\n✅ Process complete!');
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Process failed:', error.message);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default updateGitHubSecret;

