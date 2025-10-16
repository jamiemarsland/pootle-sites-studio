# Cloud Sync Implementation for Pootle Sites

## ✅ Implementation Complete

This document outlines the cloud-sync implementation for Pootle Sites using Lovable Cloud (Supabase).

## Architecture Overview

### Backend Infrastructure (Lovable Cloud/Supabase)

1. **Database Tables**
   - `profiles`: User profile data (auto-created on signup)
   - `sites`: Site metadata with cloud sync timestamps
   
2. **Storage**
   - Bucket: `wordpress-sites`
   - Structure: `{user_id}/{site_id}/database.json` and `files.json`
   
3. **Row Level Security (RLS)**
   - All tables and storage buckets have proper RLS policies
   - Users can only access their own data

### Authentication

- **Required**: Email/password authentication
- **Auto-confirm**: Enabled for faster testing
- **Session management**: Proper session + user state tracking
- **Protected routes**: Dashboard and Site pages require authentication

### Cloud Sync Strategy

**Local-first architecture:**
- Local OPFS is the source of truth
- Cloud acts as backup and cross-device sync
- Changes sync FROM local TO cloud (not vice versa after initial download)

**Sync triggers:**
- Site creation → immediate metadata sync
- Site initialization → upload files after WordPress setup
- Periodic sync → every 30 seconds when site is open
- On navigation away → final sync before leaving site
- Manual sync → retry button for failed syncs

**Debouncing:**
- 5-second debounce on cloud uploads
- Prevents excessive API calls during rapid changes

## User Flow

### New User
1. Sign up at `/auth`
2. Redirected to dashboard
3. Create first site → synced to cloud immediately
4. Open site → WordPress initializes → files uploaded to cloud
5. Changes auto-sync every 30 seconds

### Returning User (Same Device)
1. Sign in at `/auth`
2. Dashboard loads sites from cloud
3. Sites already in local OPFS → ready to use
4. Continue working → changes sync to cloud

### Returning User (New Device)
1. Sign in at `/auth`
2. Dashboard loads sites from cloud
3. Sites downloaded to local OPFS on first load
4. WordPress restored from cloud files
5. Continue working → changes sync to cloud

## File Structure

```
src/
├── contexts/
│   └── AuthContext.tsx          # Authentication state management
├── pages/
│   ├── Auth.tsx                 # Login/signup page
│   ├── Dashboard.tsx            # Site list with cloud sync
│   └── Site.tsx                 # WordPress editor with sync status
├── components/
│   ├── ProtectedRoute.tsx       # Route protection
│   ├── SyncStatus.tsx           # Sync status indicator
│   └── SiteCard.tsx             # Site card with sync info
└── utils/
    ├── cloudSync.ts             # Cloud sync utilities
    ├── storage.ts               # Local storage utilities
    └── playground.ts            # WordPress Playground setup
```

## Key Features

### ✅ Authentication
- Email/password signup and signin
- Session persistence across page reloads
- Auto-redirect when authenticated/unauthenticated
- User dropdown with logout

### ✅ Cloud Database
- Sites metadata stored in Supabase
- Real-time sync status tracking
- Last synced timestamps

### ✅ Cloud Storage
- WordPress files and database backed up to Supabase Storage
- Automatic upload after changes
- Download on new devices

### ✅ Sync Status
- Visual indicators: ✓ Synced, ↻ Syncing, ⚠ Error, ⊗ Offline
- Retry button for failed syncs
- Toast notifications for sync events

### ✅ Security
- Row Level Security on all tables
- Storage policies ensure user isolation
- No shared data between users

## Testing Checklist

- [x] Sign up with new account
- [x] Create site → verify metadata in cloud database
- [x] Open site → verify files uploaded to storage
- [x] Logout → login again → verify site restored
- [x] Login from incognito window → verify sites downloaded
- [x] Make changes → verify sync status updates
- [x] Delete site → verify removed from cloud
- [x] Network offline → verify offline indicator
- [x] RLS policies prevent cross-user access

## Environment Configuration

**Lovable Cloud automatically provides:**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- Supabase client configured in `src/integrations/supabase/client.ts`

**No manual configuration needed!**

## Future Enhancements (Not in MVP)

- Real-time sync using Supabase Realtime
- Conflict resolution (3-way merge)
- Site sharing with other users
- Export site as ZIP
- Site templates
- Usage analytics
- Multi-device concurrent editing

## Support

For issues or questions:
1. Check browser console for detailed logs
2. Verify network connectivity
3. Check Lovable Cloud status
4. Review RLS policies in backend

---

**Implementation completed**: ✅ All phases complete
**Status**: Production ready
**Last updated**: 2025-10-16
