// public/js/script.js

// -------------------------------------------------------------------------------------------------------------------
// 1) INITIALIZE FIREBASE
// -------------------------------------------------------------------------------------------------------------------

const cfg = window._env_;
if (!cfg) {
  console.error("Missing config! Did you forget to serve config.js?");
} else {
  const firebaseConfig = {
    apiKey:             cfg.FIREBASE_API_KEY,
    authDomain:         cfg.FIREBASE_AUTH_DOMAIN,
    databaseURL:        cfg.FIREBASE_DB_URL,
    projectId:          cfg.FIREBASE_PROJECT_ID,
    storageBucket:      cfg.FIREBASE_STORAGE_BUCKET,
    messagingSenderId:  cfg.FIREBASE_MESSAGING_SENDER_ID,
    appId:              cfg.FIREBASE_APP_ID,
    measurementId:      cfg.FIREBASE_MEASUREMENT_ID
  };
  firebase.initializeApp(firebaseConfig);
}

// -------------------------------------------------------------------------------------------------------------------
// 2) DOM REFERENCES
// -------------------------------------------------------------------------------------------------------------------

const uiContainer        = document.getElementById('firebaseui-auth-container');
const loader             = document.getElementById('loader');
const appContent         = document.getElementById('app-content');
const housesContainer    = document.getElementById('houses-container');
//const userEmailSpan      = document.getElementById('user-email');
const userNameSpan     	 = document.getElementById('user-name');
const signOutButton      = document.getElementById('sign-out-button');
const errorMessage       = document.getElementById('error-message');
//const themeToggleBtn     = document.getElementById('toggle-theme');
const showBuilderBtn     = document.getElementById('show-shortcut-builder');
const builderSection     = document.getElementById('shortcut-builder');
const closeBuilderBtn    = document.getElementById('close-shortcut-builder');

const showScheduleBtn      = document.getElementById("show-schedule-window");
const scheduleModal        = document.getElementById("schedule-window");
const closeScheduleBtn     = document.getElementById("close-schedule-window");
const schHouseSelect       = document.getElementById("sch-house-select");
const schDeviceSelect      = document.getElementById("sch-device-select");
const schCommandSelect     = document.getElementById("sch-command-select");
const schTypeRadios        = document.getElementsByName("sch-type");
const schOncePicker        = document.getElementById("sch-once-picker");
const schDailyPicker       = document.getElementById("sch-daily-picker");
const schOnceDateTimeInput = document.getElementById("sch-once-datetime");
const schDailyTimeInput    = document.getElementById("sch-daily-time");
const schSubmitBtn         = document.getElementById("sch-submit-btn");

// Shortcut Builder DOM references
let sbHouseSelect        = null;
let sbDeviceSelect       = null;
let sbActionSelect       = null;
let sbGenerateBtn        = null;
let sbRunContainer       = null;
let sbRunLink            = null;

let currentUser          = null;
const listeners          = {}; // for Realtime Database listeners on devices


// -------------------------------------------------------------------------------------------------------------------
// 3) FIREBASEUI SETUP (for login)
// -------------------------------------------------------------------------------------------------------------------

const ui = new firebaseui.auth.AuthUI(firebase.auth());
const uiConfig = {
  callbacks: {
    signInSuccessWithAuthResult: () => false,
    uiShown: () => loader.style.display = 'none',
    signInFailure: e => {
      showError(e.code==='auth/popup-closed-by-user'
        ? 'Login popup closed. Try again.'
        : `Login failed: ${e.message}`);
      return false;
    }
  },
  signInFlow: 'popup',
  signInOptions: [
    firebase.auth.EmailAuthProvider.PROVIDER_ID,
    firebase.auth.GoogleAuthProvider.PROVIDER_ID
  ]
};

// -------------------------------------------------------------------------------------------------------------------
// 4) DARK-MODE TOGGLE
// -------------------------------------------------------------------------------------------------------------------

//themeToggleBtn.addEventListener('click', () =>
//  document.documentElement.classList.toggle('dark')
//);

// -------------------------------------------------------------------------------------------------------------------
// 5) AUTH STATE LISTENER
// -------------------------------------------------------------------------------------------------------------------

firebase.auth().onAuthStateChanged(user => {
  clearError();
  if (user) {
    currentUser = user;
//    userEmailSpan.textContent = user.email;
	userNameSpan.textContent = user.displayName || user.email.split('@')[0];
    uiContainer.classList.add('hidden');
    loader.classList.add('hidden');
    appContent.classList.remove('hidden');
    resetListeners();
	firebase.database().goOnline();
    //loadUserDevices(user.uid);
	const uid = user.uid;
    const userRef = firebase.database().ref(`users/${uid}`);
    const now = Date.now();

    userRef.once('value')
      .then(snapshot => {
        if (!snapshot.exists()) {
          // first‑time login: create the record
          return userRef.set({
            email:       user.email,
            displayName: user.displayName || "",
            createdAt:   now,
            lastLogin:   now
          });
        } else {
          // subsequent login: just bump lastLogin
          return userRef.update({
            lastLogin: now
          });
        }
      })
      .catch(err => {
        console.error("Error writing user profile:", err);
      });

    // then load devices, etc.
    loadUserDevices(user.uid);
	showBuilderBtn.style.display = 'inline-block';
	showScheduleBtn.style.display = 'inline-block';
	signOutButton.style.display = 'inline-block';
    // …
  } 
  
  else {
    currentUser = null;
    uiContainer.classList.remove('hidden');
    loader.classList.remove('hidden');
    appContent.classList.add('hidden');
    resetListeners();
    showBuilderBtn.style.display = 'none';
	showScheduleBtn.style.display = 'none';
	signOutButton.style.display = 'none';
    firebase.database().goOffline();
    ui.start('#firebaseui-auth-container', uiConfig);
	
	 // not signed in → hide your app UI, show login
  }
});

// -------------------------------------------------------------------------------------------------------------------
// 6) SIGN-OUT BUTTON
// -------------------------------------------------------------------------------------------------------------------

signOutButton.addEventListener('click', () =>
  firebase.auth().signOut().catch(e => showError(`Sign-out failed: ${e.message}`))
);

// -------------------------------------------------------------------------------------------------------------------
// 7) LOAD USER DEVICES (FOR DISPLAY)
// -------------------------------------------------------------------------------------------------------------------

function loadUserDevices(uid) {
  // Read /user_access/{uid} to get a mapping of deviceId → { houseId: true, ... }
  const accessRef = firebase.database().ref(`user_access/${uid}`);
  accessRef.once('value')
    .then(snap => {
      const access = snap.val() || {};
      Object.entries(access).forEach(([deviceId, houses]) => {
        Object.keys(houses).forEach(houseId => {
          ensureHouseSection(houseId);
          attachListener(houseId, deviceId);
        });
      });
      if (!housesContainer.hasChildNodes()) {
        housesContainer.innerHTML = '<p class="text-gray-500 dark:text-gray-400">No authorized devices.</p>';
      }
    })
    .catch(e => showError(`Failed to load devices: ${e.message}`));
}

// Create a “House” section <div> if not already present
function ensureHouseSection(houseId) {
  if (document.getElementById(`house-${houseId}`)) return;
  const section = document.createElement('div');
  section.id = `house-${houseId}`;
  section.innerHTML = `
    <h4 class="text-lg font-semibold mb-4">House: ${houseId}</h4>
    <div id="devices-${houseId}"
         class="grid gap-6 justify-center
                grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
    </div>
  `;
  housesContainer.appendChild(section);
}

// Attach a Realtime Database listener to /houses/{houseId}/devices/{deviceId}
function attachListener(houseId, deviceId) {
  const key = `${houseId}-${deviceId}`;
  if (listeners[key]) return;
  const ref = firebase.database().ref(`houses/${houseId}/devices/${deviceId}`);
  listeners[key] = { ref, houseId, deviceId };
  ref.on('value',
    snap => renderCard(key, snap.val()),
    e => {
      ref.off(); delete listeners[key];
      const c = document.getElementById(key);
      if (c) c.innerHTML = `<p class="text-red-500">Error: ${e.message}</p>`;
    }
  );
}

// Remove all listeners & clear UI
function resetListeners() {
  Object.values(listeners).forEach(l => l.ref.off());
  Object.keys(listeners).forEach(k => delete listeners[k]);
  housesContainer.innerHTML = '';
}

// Render or update a device card
function renderCard(key, data) {
  const { houseId, deviceId } = listeners[key];
  const container = document.getElementById(`devices-${houseId}`);
  if (!data) {
    document.getElementById(key)?.remove();
    return;
  }
  let card = document.getElementById(key);
  if (!card) {
    card = document.createElement('article');
    card.id = key;
    card.className = [
      'bg-white dark:bg-gray-800 dark:text-gray-100',
      'rounded-2xl shadow-lg p-6',
      'flex flex-col transition-transform hover:scale-105',
      'min-w-[240px] max-w-full'
    ].join(' ');
    container.appendChild(card);
  }

  const icon = data.type==='light'
    ? '<svg class="h-6 w-6 text-yellow-400" data-icon="outline:light-bulb"></svg>'
    : '<svg class="h-6 w-6 text-indigo-500" data-icon="outline:home"></svg>';

  card.innerHTML = `
	  <header class="flex items-center space-x-2 mb-3">
		${icon}
		<h5 class="font-semibold truncate">${data.name || deviceId}</h5>
	  </header>
	  <p class="mb-4 text-sm">
		State: <span class="font-medium">${data.state||'Unknown'}</span>
	  </p>

	  <!-- here: stack on mobile, row on sm+ -->
	  <div
		class="mt-auto flex flex-col sm:flex-row gap-2">
	  </div>
	`;

  const opts = data.type==='gate'
    ? [['Open','OPEN'],['Close','CLOSE'],['Stop','STOP']]
    : [['On','ON'],['Off','OFF']];

  opts.forEach(([label,val]) => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.key   = key;
    btn.dataset.state = val;
    btn.className = [
      'flex-1 py-2 rounded-lg text-white font-medium',
      (val==='ON'||val==='OPEN')
        ? 'bg-green-500 hover:bg-green-600'
        : 'bg-gray-500 hover:bg-gray-600'
    ].join(' ');
    card.lastElementChild.appendChild(btn);
  });
}

// Handle control button clicks on device cards
housesContainer.addEventListener('click', e => {
  if (e.target.tagName!=='BUTTON') return;
  const key = e.target.dataset.key;
  if (!key || !currentUser) return showError('Please log in first.');
  const { houseId, deviceId } = listeners[key];
  firebase.database()
    .ref(`houses/${houseId}/devices/${deviceId}/command`)
    .set(e.target.dataset.state)
    .catch(e => showError(`Command failed: ${e.message}`));
});

// -------------------------------------------------------------------------------------------------------------------
// 8) ERROR HANDLING HELPERS
// -------------------------------------------------------------------------------------------------------------------

function showError(msg) {
  errorMessage.textContent = msg;
  errorMessage.classList.remove('hidden');
}
function clearError() {
  errorMessage.textContent = '';
  errorMessage.classList.add('hidden');
}

// -------------------------------------------------------------------------------------------------------------------
// 9) SHORTCUT BUILDER LOGIC
// -------------------------------------------------------------------------------------------------------------------

// Called once to wire up builder functionality
function initializeBuilder() {
  if (window._sbInit) return;   // only once
  window._sbInit = true;

  const auth = firebase.auth();

  // Grab builder DOM elements (in the exact order defined in HTML)
  sbHouseSelect   = document.getElementById('sb-house-select');
  sbDeviceSelect  = document.getElementById('sb-device-select');
  sbActionSelect  = document.getElementById('sb-action-select');
  sbGenerateBtn   = document.getElementById('sb-generate-btn');
  sbRunContainer  = document.getElementById('sb-run-container');
  sbRunLink       = document.getElementById('sb-run-link');
  
  // 9.1) Populate “House” dropdown from /user_access/{uid}
  auth.currentUser && populateHouseDropdown(auth.currentUser.uid);
  
  // 9.2) When user picks a house, populate the “Device” dropdown
  sbHouseSelect.addEventListener('change', () => {
    const houseId = sbHouseSelect.value;
  
    // Reset device & action selectors
    sbDeviceSelect.innerHTML = '<option value="" class="bg-gray-900 text-gray-100">-- Choose Device --</option>';
    sbDeviceSelect.disabled = true;
    sbActionSelect.value = '';
    sbActionSelect.disabled = true;
    sbGenerateBtn.disabled = true;
    sbRunContainer.style.display = 'none';
  
    if (!houseId) return;
  
    // Read /user_access/{uid}/{houseId} to get the list of devices
    const uid = auth.currentUser.uid;
    firebase.database().ref(`user_access/${uid}/${houseId}`)
      .once('value')
      .then(snap => {
        const devicesObj = snap.val() || {};
        Object.keys(devicesObj).forEach(deviceId => {
          const opt = document.createElement('option');
          opt.value = deviceId;
          opt.textContent = deviceId;
          sbDeviceSelect.appendChild(opt);
        });
        sbDeviceSelect.disabled = false;
      })
      .catch(e => showError(`Failed to load devices for ${houseId}: ${e.message}`));
  });
  
  // 9.3) When user picks a device, enable the action dropdown
  sbDeviceSelect.addEventListener('change', () => {
    if (sbDeviceSelect.value) {
      sbActionSelect.disabled = false;
    } else {
      sbActionSelect.value = '';
      sbActionSelect.disabled = true;
    }
    sbGenerateBtn.disabled = true;
    sbRunContainer.style.display = 'none';
  });
  
  // 9.4) When user picks an action, enable “Generate & Run Shortcut”
  sbActionSelect.addEventListener('change', () => {
    if (sbHouseSelect.value && sbDeviceSelect.value && sbActionSelect.value) {
      sbGenerateBtn.disabled = false;
    } else {
      sbGenerateBtn.disabled = true;
    }
    sbRunContainer.style.display = 'none';
  });

  // 9.5) Generate & Run Shortcut button click
  sbGenerateBtn.addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) {
      return showError('You must be signed in to build a shortcut.');
    }

    const idToken = await user.getIdToken(true).catch(e => {
      showError(`Failed to get ID token: ${e.message}`);
      return null;
    });
    if (!idToken) return;

    const houseId  = sbHouseSelect.value;
    const deviceId = sbDeviceSelect.value;
    const command  = sbActionSelect.value;

    // Build the JSON payload
    const payload = {
      uid:      user.uid,
      houseId:  houseId,
      deviceId: deviceId,
      command:  command,
      idToken:  idToken
    };

    const shortcutName = 'ControlDevice';
    const encodedInput = encodeURIComponent(JSON.stringify(payload));
    const runUrl = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName)}&input=${encodedInput}`;

    sbRunLink.href = runUrl;
    sbRunContainer.style.display = 'block';
    sbRunLink.scrollIntoView({ behavior: 'smooth' });
  });

  // 9.6) Copy URL if needed (optional; link can be tapped directly on iOS)
  document.getElementById('sb-copy-url-btn')?.addEventListener('click', () => {
    navigator.clipboard.writeText(sbRunLink.href)
      .then(() => alert('✅ Shortcut URL copied to clipboard.'))
      .catch(() => alert('❌ Copy failed. Please copy manually: ' + sbRunLink.href));
  });
}

// Populate the house dropdown based on /user_access/{uid}
function populateHouseDropdown(uid) {
  const ref = firebase.database().ref(`user_access/${uid}`);
  ref.once('value')
    .then(snap => {
      const access = snap.val() || {};
      Object.keys(access).forEach(houseId => {
        const opt = document.createElement('option');
        opt.value = houseId;
        opt.textContent = houseId;
        sbHouseSelect.appendChild(opt);
      });
    })
    .catch(e => showError(`Failed to load houses: ${e.message}`));
}

// -------------------------------------------------------------------------------------------------------------------
// 10) HOOK UP BUILDER BUTTON (so initializeBuilder can run)
// -------------------------------------------------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  showBuilderBtn.addEventListener('click', () => {
    builderSection.style.display = 'block';
    initializeBuilder();
  });
  closeBuilderBtn.addEventListener('click', () => {
    builderSection.style.display = 'none';
  });
  /*showScheduleBtn.addEventListener('click', () => {
    scheduleSection.style.display = 'block';
    initializeBuilder();
  });
  closeShedulerBtn.addEventListener('click', () => {
    scheduleSection.style.display = 'none';
  });*/
});

// Helper: format HH and MM to two digits
function pad2(n) {
  return String(n).padStart(2, "0");
}

// 2) Open the modal when “Schedule Command” is clicked
showScheduleBtn.addEventListener("click", () => {
  // Reset dropdowns & pickers
  schHouseSelect.innerHTML = '<option value="">-- Choose House --</option>';
  schDeviceSelect.innerHTML = '<option value="">-- Choose Device --</option>';
  schHouseSelect.disabled = true;
  schCommandSelect.value = "";
  schCommandSelect.disabled = true;
  schOnceDateTimeInput.value = "";
  schDailyTimeInput.value = "";
  schSubmitBtn.disabled = true;

  // Show the “One-Time” picker by default:
  schOncePicker.style.display = "block";
  schDailyPicker.style.display = "none";
  schTypeRadios[0].checked = true;

  // Populate the Device dropdown from /user_access/{uid}
  const user = firebase.auth().currentUser;
  if (!user) {
    alert("You must be signed in to schedule commands.");
    return;
  }
  const uid = user.uid;

  firebase.database().ref(`user_access/${uid}`)
    .once("value")
    .then(snap => {
      const access = snap.val() || {};
      Object.keys(access).forEach(deviceId => {
        // In your structure, user_access/{uid}/{deviceId}: { houseId: true, ... }
        // Actually, your access might be /user_access/{uid}/{houseId}/{deviceId}: true
        // Adjust accordingly. If it’s the latter, do this:
        // Object.entries(access).forEach(([houseId, devices]) => { … });
        // But based on our earlier schema, it was /user_access/{uid}/{houseId}/{deviceId}: true
      });
      // If your structure is:
      //   user_access/{uid}/{houseId}/{deviceId} = true
      // then iterate like this:
      //schHouseSelect.innerHTML = '<option value="">-- Choose House --</option>';
      //Object.entries(access).forEach(([houseId, devices]) => {
      //  if (typeof devices === "object") {
      //    const opt = document.createElement("option");
      //    opt.value = houseId;
      //    opt.textContent = houseId;
      //    schHouseSelect.appendChild(opt);
      //  }
      //}
	  schDeviceSelect.innerHTML = '<option value="">-- Choose Device --</option>';
      Object.entries(access).forEach(([devicesId, houses]) => {
        if (typeof houses === "object") {
          const opt = document.createElement("option");
          opt.value = devicesId;
          opt.textContent = devicesId;
          schDeviceSelect.appendChild(opt);
        }
      });
    })
    .catch(err => {
      console.error("Error loading houses for schedule:", err);
      alert("Failed to load houses. See console.");
    });

  // Finally, show the modal
  scheduleModal.classList.remove("hidden");
});

// 3) Close the modal
closeScheduleBtn.addEventListener("click", () => {
  scheduleModal.classList.add("hidden");
});

// Also close if user clicks outside the dialog (optional)
scheduleModal.addEventListener("click", (e) => {
  if (e.target === scheduleModal) {
    scheduleModal.classList.add("hidden");
  }
});

// 4) When a device is selected, load its devices
schDeviceSelect.addEventListener("change", () => {
  const deviceId = schDeviceSelect.value;
  schHouseSelect.innerHTML = '<option value="">-- Choose Device --</option>';
  schHouseSelect.disabled = true;
  schCommandSelect.value = "";
  schCommandSelect.disabled = true;
  schSubmitBtn.disabled = true;

  if (!deviceId) return;

  const uid = firebase.auth().currentUser.uid;
  firebase.database().ref(`user_access/${uid}/${deviceId}`)
    .once("value")
    .then(snap => {
      const devs = snap.val() || {};
      Object.keys(devs).forEach(houseId => {
        const opt = document.createElement("option");
        opt.value = houseId;
        opt.textContent = houseId;
        schHouseSelect.appendChild(opt);
      });
      schHouseSelect.disabled = false;
    })
    .catch(err => {
      console.error("Error loading devices for schedule:", err);
      alert("Failed to load devices. See console.");
    });
});

// 5) When a device is selected, enable the Command dropdown
schDeviceSelect.addEventListener("change", () => {
  if (schDeviceSelect.value) {
    schCommandSelect.disabled = false;
  } else {
    schCommandSelect.value = "";
    schCommandSelect.disabled = true;
  }
  schSubmitBtn.disabled = true;
});

// 6) When a command is selected, maybe enable the submit button
schCommandSelect.addEventListener("change", () => {
  updateScheduleSubmitState();
});

// 7) When recurrence type (once/daily) changes:
for (let radio of schTypeRadios) {
  radio.addEventListener("change", () => {
    if (radio.checked) {
      if (radio.value === "once") {
        schOncePicker.style.display = "block";
        schDailyPicker.style.display = "none";
      } else {
        schOncePicker.style.display = "none";
        schDailyPicker.style.display = "block";
      }
      updateScheduleSubmitState();
    }
  });
}

// 8) When date/time inputs change, update submit state
schOnceDateTimeInput.addEventListener("change", updateScheduleSubmitState);
schDailyTimeInput.addEventListener("change", updateScheduleSubmitState);

function updateScheduleSubmitState() {
  const houseId  = schHouseSelect.value;
  const deviceId = schDeviceSelect.value;
  const command  = schCommandSelect.value;
  const type     = Array.from(schTypeRadios).find(r => r.checked).value;

  let ready = houseId && deviceId && command;
  if (type === "once") {
    ready = ready && schOnceDateTimeInput.value.trim() !== "";
  } else {
    ready = ready && schDailyTimeInput.value.trim() !== "";
  }
  schSubmitBtn.disabled = !ready;
}

// 9) On click “Schedule Command”:
schSubmitBtn.addEventListener("click", async () => {
  const user = firebase.auth().currentUser;
  if (!user) {
    alert("Please sign in to schedule commands.");
    return;
  }

  const houseId  = schHouseSelect.value;
  const deviceId = schDeviceSelect.value;
  const command  = schCommandSelect.value;
  const type     = Array.from(schTypeRadios).find(r => r.checked).value;

  // Build the schedule entry
  let entry = {
    uid:         user.uid,
    houseId:     houseId,
    deviceId:    deviceId,
    command:     command,
    type:        type,       // "once" or "daily"
    lastRunDate: ""         // start empty
  };

  if (type === "once") {
    const dtString = schOnceDateTimeInput.value;   // e.g. "2025-08-01T14:30"
    const dt       = new Date(dtString);
    if (isNaN(dt.getTime())) {
      alert("Invalid date/time.");
      return;
    }
    if (dt.getTime() <= Date.now()) {
      alert("Please choose a future date/time.");
      return;
    }
	entry.timeKey = `${pad2(entry.hour)}:${pad2(entry.minute)}`;
    entry.runAt = dt.getTime();
    entry.hour  = null;
    entry.minute = null;
  } 
  else { // daily
    const timeStr = schDailyTimeInput.value;        // e.g. "07:00"
    const [hh, mm] = timeStr.split(":").map(Number);
    if (isNaN(hh) || isNaN(mm)) {
      alert("Invalid time.");
      return;
    }
    entry.hour   = hh;
    entry.minute = mm;
    entry.runAt  = null;
	entry.timeKey = `${pad2(entry.hour)}:${pad2(entry.minute)}`;
  }

  try {
    await firebase.database().ref("scheduled_commands").push(entry);
    alert(
      type === "once"
        ? `Scheduled one-time “${command}” for ${deviceId} at ${new Date(entry.runAt).toLocaleString()}.`
        : `Scheduled daily “${command}” for ${deviceId} at ${pad2(entry.hour)}:${pad2(entry.minute)} every day.`
    );
    scheduleModal.classList.add("hidden");
  } catch (err) {
    console.error("Error scheduling command:", err);
    alert("Failed to schedule: " + err.message);
  }
});