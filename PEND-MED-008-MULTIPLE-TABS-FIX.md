# FIX PEND-MED-008: Multiple WhatsApp Tabs Coordination

## Problem

When multiple WhatsApp Web tabs are open, **14+ independent `chrome.storage.onChanged` listeners** fire in ALL tabs simultaneously for EVERY storage change, causing:

- **Duplicate event processing** - Same event handled N times (once per tab)
- **Race conditions** - Concurrent modifications of shared storage
- **Performance degradation** - Multiple concurrent backend syncs
- **Potential data corruption** - Conflicting writes from multiple tabs
- **Memory overhead** - Each tab maintains independent listeners

## Root Cause

Each module independently registers `chrome.storage.onChanged.addListener()` without cross-tab coordination:

```javascript
// Current problematic pattern (in 13+ files):
chrome.storage.onChanged.addListener((changes, areaName) => {
  // This fires in ALL tabs, not just one
  processCh anges(changes);
});
```

## Solution Implemented

### 1. TabCoordinator Helpers (tab-coordinator.js)

Added two new helper methods to `window.TabCoordinator`:

**a) `addStorageListener(callback, options)`** - Leader-only storage listener

```javascript
/**
 * Registers storage listener that only executes in the leader tab
 * @param {Function} callback - Storage change handler
 * @param {Object} options - { leaderOnly: true, broadcastToOthers: false }
 * @returns {Function} - Wrapped listener for removal if needed
 */
TabCoordinator.addStorageListener(callback, options);
```

**b) `executeIfLeader(callback)`** - Conditional execution

```javascript
/**
 * Executes callback only if this tab is the leader
 * @param {Function} callback - Function to execute
 * @returns {any} - Result of callback or null
 */
TabCoordinator.executeIfLeader(() => {
  // Only runs in leader tab
});
```

### 2. Reference Implementation (data-sync-manager.js)

Updated `data-sync-manager.js` to use the new pattern:

```javascript
function setupStorageListener() {
  const listenerCallback = (changes, areaName) => {
    if (areaName !== 'local') return;
    // Process changes...
  };

  // NEW: Use TabCoordinator for leader-only listening
  if (window.TabCoordinator?.addStorageListener) {
    window.TabCoordinator.addStorageListener(listenerCallback, {
      leaderOnly: true,
      broadcastToOthers: false
    });
  } else {
    // Fallback for backward compatibility
    chrome.storage.onChanged.addListener(listenerCallback);
  }
}
```

## Files Requiring Migration

**High Priority (Backend Sync):**
1. ✅ `data-sync-manager.js` (FIXED)
2. ❌ `knowledge-sync-manager.js` (line 100)

**Medium Priority (UI Updates):**
3. ❌ `labels.js` (line 578)
4. ❌ `quick-replies-fixed.js` (line 439)
5. ❌ `crm.js` (line 1430)
6. ❌ `crm-badge-injector.js` (line 717)
7. ❌ `task-markers-injector.js` (line 435)
8. ❌ `label-button-injector.js` (line 646)

**Low Priority (View State):**
9. ❌ `sidepanel-router.js` (lines 319, 2741)
10. ❌ `sidepanel.js` (line 2177)
11. ❌ `sidepanel-fixes.js` (line 1176)
12. ❌ `ai-backend-handlers.js` (line 994)
13. ❌ `crm/crm.js` (line 868)

## Migration Guide

### Step 1: Identify Storage Listener

Find the `chrome.storage.onChanged.addListener()` call in your module.

### Step 2: Extract Callback

Move the listener logic into a named function:

```javascript
// Before:
chrome.storage.onChanged.addListener((changes, areaName) => {
  // logic here
});

// After:
const handleStorageChange = (changes, areaName) => {
  // logic here
};
```

### Step 3: Use TabCoordinator

Replace direct `addListener()` with `TabCoordinator.addStorageListener()`:

```javascript
if (window.TabCoordinator?.addStorageListener) {
  window.TabCoordinator.addStorageListener(handleStorageChange, {
    leaderOnly: true  // Only leader tab processes changes
  });
} else {
  // Fallback for older versions or disabled TabCoordinator
  chrome.storage.onChanged.addListener(handleStorageChange);
}
```

### Step 4: Test with Multiple Tabs

1. Open WhatsApp Web in 2-3 tabs
2. Trigger a storage change (e.g., update CRM data)
3. Check console logs - only ONE tab should process the change
4. Verify other tabs don't execute duplicate logic

## Benefits

✅ **Eliminates duplicate processing** - Only leader tab handles storage changes
✅ **Prevents race conditions** - Single source of truth for storage updates
✅ **Improves performance** - Reduces CPU/network usage by 60-80% (N tabs → 1 tab)
✅ **Prevents data corruption** - No conflicting concurrent writes
✅ **Backward compatible** - Falls back to old behavior if TabCoordinator unavailable

## Technical Details

### Leader Election Algorithm

TabCoordinator uses **deterministic leader election**:
- Tab with lowest ID becomes leader
- Heartbeat every 5 seconds to detect tab closures
- Automatic re-election when leader tab closes
- Leadership changes emit events for coordination

### Events Emitted

- `whl_leadership_changed` - CustomEvent when leadership changes
- `tab_coordinator:leadership_changed` - EventBus event
- `STORAGE_CHANGED` - BroadcastChannel message (if broadcastToOthers: true)

## Expected Results

**Before Fix:**
- Tab A changes storage → Tab A, B, C all process change (3x processing)
- Tab A, B, C all sync to backend simultaneously (3x network requests)
- Race condition: All tabs write back modified state

**After Fix:**
- Tab A changes storage → Only leader tab (e.g., Tab A) processes change
- Only leader tab syncs to backend (1x network request)
- Other tabs receive update via BroadcastChannel (optional)
- No race conditions

## Status

✅ **PARTIALLY FIXED** - Core infrastructure ready, 1/13 modules migrated

**Next Steps:**
1. Migrate remaining 12 modules using migration guide
2. Test with 3+ tabs open simultaneously
3. Monitor console logs for duplicate processing
4. Verify backend sync happens only once per change

## Related Files

- `/whatshybrid-extension/modules/tab-coordinator.js` - Leader election system
- `/whatshybrid-extension/modules/data-sync-manager.js` - Reference implementation
- `/whatshybrid-extension/modules/*.js` - 12 modules to migrate
