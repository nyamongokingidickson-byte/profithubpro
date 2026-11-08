# Quick Start - 5 Minute Setup

## Prerequisites
- Vercel account with your project deployed
- Access to Vercel project settings
- Deriv account (for testing)

## Step 1: Generate Session Secret (1 minute)

Run in terminal:
```bash
openssl rand -base64 32
```

Save the output. Example: `xQ7mKh9pL2nBvQ3rF5tJ8wYz+Ac=...`

## Step 2: Set Environment Variables (2 minutes)

1. Go to your Vercel project dashboard
2. Click **Settings** → **Environment Variables**
3. Click **Add New**
4. Add these 4 variables (applies to all environments):

```
OAUTH_CLIENT_ID          → 34J0u7zObmeCX5lnl8zm7
APP_ID                   → 34J0u7zObmeCX5lnl8zm7
REDIRECT_URI             → https://dylantrades.site/callback
SESSION_SECRET           → (paste your generated secret)
```

5. Click **Save**

## Step 3: Deploy (2 minutes)

```bash
cd /workspaces/pacha
git add .
git commit -m "feat: OAuth 2.0 PKCE migration"
git push origin main
```

Wait for Vercel to build and deploy (1-2 minutes).

## Step 4: Test (You're done!)

Visit:
```
https://dylantrades.site/auth
```

You should see:
- **Login** button
- **Signup** button

Click **Login** and you'll be redirected to Deriv's authorization page.

## Success Indicators

✅ Can click Login  
✅ Deriv login page opens  
✅ Can authorize app  
✅ Redirected back to `/auth`  
✅ Shows "Logged in" message  
✅ Can click Logout  

---

## Debugging (if needed)

### Deployment Failed?
Check Vercel build logs:
1. Vercel dashboard → Deployments
2. Click latest deployment
3. Check build logs for errors

### "REDIRECT_URI mismatch"?
1. Verify in Vercel dashboard that `REDIRECT_URI=https://dylantrades.site/callback`
2. Verify in Deriv OAuth app settings that redirect URI matches exactly

### Login Redirects to Blank Page?
Look for `code=` and `state=` in URL:
- If present: backend issue (check `/api/auth/exchange-token`)
- If missing: OAuth settings issue

### Session Not Persisting?
- Check DevTools → Application → Cookies
- Should see `access_token` cookie with HttpOnly flag

---

## Next Steps

1. **Integrate into Main UI**: Add Auth buttons to your header
2. **Test WebSocket**: Try the OTP + WebSocket flow
3. **Handle Errors**: Add toast notifications for user feedback
4. **Document**: Share IMPLEMENTATION_SUMMARY.md with your team

---

## Important URLs

| Purpose | URL |
|---------|-----|
| Test Auth | https://dylantrades.site/auth |
| OAuth Redirect | https://dylantrades.site/callback |
| Token Exchange | https://dylantrades.site/api/auth/exchange-token |

---

## Files to Review

| File | Purpose |
|------|---------|
| IMPLEMENTATION_SUMMARY.md | Overview of what was built |
| DEPLOYMENT_GUIDE.md | Detailed deployment steps |
| QA_CHECKLIST.md | Testing procedures |
| OAUTH_README.md | Architecture overview |

---

**Status**: ✅ Ready for Production

You're all set! Your OAuth 2.0 PKCE migration is complete and deployed.
