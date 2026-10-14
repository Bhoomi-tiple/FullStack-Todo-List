// To-Do List Application with Web Push Notifications
// Bhoomi's To-Do List (Assignment 3)
const express = require('express');
const mongoose = require('mongoose');
const webpush = require('web-push');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ==========================================
// 1. DATA STORAGE (MongoDB + Fallback Local Store)
// ==========================================

const DATA_FILE = path.join(__dirname, 'todo_data.json');

class LocalStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { todos: [], subs: [], config: [] };
    this.load();
  }
  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this.data.todos = Array.isArray(parsed.todos) ? parsed.todos : [];
        this.data.subs = Array.isArray(parsed.subs) ? parsed.subs : [];
        this.data.config = Array.isArray(parsed.config) ? parsed.config : [];
        this.data.todos.forEach(t => {
          if (t.reminderTime) t.reminderTime = new Date(t.reminderTime);
        });
      }
    } catch (e) {
      console.warn('Could not read existing local data file, starting with clean store:', e.message);
    }
  }
  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.warn('Could not persist local store:', e.message);
    }
  }
}

const localStore = new LocalStore(DATA_FILE);

// Mongoose Schemas (used if MongoDB is available)
const TodoSchema = new mongoose.Schema({
  task: { type: String, required: true },
  isCompleted: { type: Boolean, default: false },
  reminderTime: { type: Date, default: null },
  reminderSent: { type: Boolean, default: false }
});
const MongooseTodo = mongoose.models.Todo || mongoose.model('Todo', TodoSchema);

const PushSubSchema = new mongoose.Schema({
  endpoint: { type: String, required: true, unique: true },
  keys: {
    p256dh: { type: String, required: true },
    auth: { type: String, required: true }
  }
});
const MongoosePushSub = mongoose.models.PushSub || mongoose.model('PushSub', PushSubSchema);

const ConfigSchema = new mongoose.Schema({
  key: { type: String, unique: true },
  publicKey: String,
  privateKey: String
});
const MongooseConfig = mongoose.models.Config || mongoose.model('Config', ConfigSchema);

let isMongoConnected = false;

// Helper to wrap local document with Mongoose-like save() method
function createLocalTodoDoc(data) {
  const doc = {
    _id: data._id ? String(data._id) : crypto.randomBytes(12).toString('hex'),
    task: data.task || '',
    isCompleted: Boolean(data.isCompleted),
    reminderTime: data.reminderTime ? new Date(data.reminderTime) : null,
    reminderSent: Boolean(data.reminderSent),
    async save() {
      const idx = localStore.data.todos.findIndex(t => String(t._id) === String(doc._id));
      const clean = {
        _id: String(doc._id),
        task: doc.task,
        isCompleted: Boolean(doc.isCompleted),
        reminderTime: doc.reminderTime ? new Date(doc.reminderTime) : null,
        reminderSent: Boolean(doc.reminderSent)
      };
      if (idx >= 0) {
        localStore.data.todos[idx] = clean;
      } else {
        localStore.data.todos.push(clean);
      }
      localStore.save();
      return doc;
    }
  };
  return doc;
}

// Unified Database Access Layer
const Todo = {
  find(query = {}) {
    if (isMongoConnected) {
      return MongooseTodo.find(query);
    }
    let list = [...localStore.data.todos];
    if (query.reminderTime && query.reminderTime.$lte) {
      const maxDate = new Date(query.reminderTime.$lte);
      list = list.filter(t => t.reminderTime && new Date(t.reminderTime) <= maxDate);
    }
    if (query.reminderSent !== undefined) {
      list = list.filter(t => Boolean(t.reminderSent) === Boolean(query.reminderSent));
    }
    if (query.isCompleted !== undefined) {
      list = list.filter(t => Boolean(t.isCompleted) === Boolean(query.isCompleted));
    }
    const docs = list.map(item => createLocalTodoDoc(item));
    return {
      then(resolve, reject) {
        return Promise.resolve(docs).then(resolve, reject);
      },
      sort(sortObj) {
        if (sortObj && sortObj.reminderTime) {
          docs.sort((a, b) => {
            if (!a.reminderTime && !b.reminderTime) return 0;
            if (!a.reminderTime) return 1;
            if (!b.reminderTime) return -1;
            return sortObj.reminderTime === 1
              ? new Date(a.reminderTime) - new Date(b.reminderTime)
              : new Date(b.reminderTime) - new Date(a.reminderTime);
          });
        }
        return Promise.resolve(docs);
      }
    };
  },
  async findById(id) {
    if (isMongoConnected) return MongooseTodo.findById(id);
    const item = localStore.data.todos.find(t => String(t._id) === String(id));
    return item ? createLocalTodoDoc(item) : null;
  },
  async findByIdAndDelete(id) {
    if (isMongoConnected) return MongooseTodo.findByIdAndDelete(id);
    const idx = localStore.data.todos.findIndex(t => String(t._id) === String(id));
    if (idx >= 0) {
      const [deleted] = localStore.data.todos.splice(idx, 1);
      localStore.save();
      return deleted;
    }
    return null;
  },
  async findOneAndUpdate(filter, update, options = {}) {
    if (isMongoConnected) return MongooseTodo.findOneAndUpdate(filter, update, options);
    const item = localStore.data.todos.find(t => {
      if (filter._id && String(t._id) !== String(filter._id)) return false;
      if (filter.reminderSent !== undefined && Boolean(t.reminderSent) !== Boolean(filter.reminderSent)) return false;
      return true;
    });
    if (!item) return null;
    const oldDoc = createLocalTodoDoc({ ...item });
    if (update.reminderSent !== undefined) item.reminderSent = Boolean(update.reminderSent);
    if (update.isCompleted !== undefined) item.isCompleted = Boolean(update.isCompleted);
    if (update.task !== undefined) item.task = update.task;
    localStore.save();
    return options.new ? createLocalTodoDoc(item) : oldDoc;
  },
  async updateOne(filter, update) {
    if (isMongoConnected) return MongooseTodo.updateOne(filter, update);
    return this.findOneAndUpdate(filter, update, { new: true });
  },
  create(data) {
    if (isMongoConnected) return MongooseTodo.create(data);
    const doc = createLocalTodoDoc(data);
    return doc.save();
  }
};

function TodoConstructor(data) {
  if (isMongoConnected) {
    return new MongooseTodo(data);
  }
  return createLocalTodoDoc(data);
}
Object.assign(TodoConstructor, Todo);

const PushSub = {
  async find(query = {}) {
    if (isMongoConnected) return MongoosePushSub.find(query);
    return localStore.data.subs.map(s => ({ ...s }));
  },
  async findOneAndUpdate(filter, update, options = {}) {
    if (isMongoConnected) return MongoosePushSub.findOneAndUpdate(filter, update, options);
    const endpoint = filter.endpoint || (update && update.endpoint);
    let item = localStore.data.subs.find(s => s.endpoint === endpoint);
    if (!item) {
      item = {
        endpoint,
        keys: {
          p256dh: update.keys.p256dh,
          auth: update.keys.auth
        }
      };
      localStore.data.subs.push(item);
    } else {
      item.keys = {
        p256dh: update.keys.p256dh,
        auth: update.keys.auth
      };
    }
    localStore.save();
    return item;
  },
  async deleteOne(filter) {
    if (isMongoConnected) return MongoosePushSub.deleteOne(filter);
    const idx = localStore.data.subs.findIndex(s => s.endpoint === filter.endpoint);
    if (idx >= 0) {
      localStore.data.subs.splice(idx, 1);
      localStore.save();
    }
    return { deletedCount: idx >= 0 ? 1 : 0 };
  }
};

const Config = {
  async findOne(filter) {
    if (isMongoConnected) return MongooseConfig.findOne(filter);
    const item = localStore.data.config.find(c => c.key === filter.key);
    return item ? { ...item } : null;
  },
  async create(data) {
    if (isMongoConnected) return MongooseConfig.create(data);
    const clean = {
      key: data.key,
      publicKey: data.publicKey,
      privateKey: data.privateKey
    };
    localStore.data.config.push(clean);
    localStore.save();
    return clean;
  }
};

// ==========================================
// 2. VAPID / Push Setup
// ==========================================

let vapidPublicKey = '';

async function initVapid() {
  let doc = await Config.findOne({ key: 'vapid' });

  if (!doc) {
    const keys = webpush.generateVAPIDKeys();
    doc = await Config.create({
      key: 'vapid',
      publicKey: keys.publicKey,
      privateKey: keys.privateKey
    });
    console.log('Generated and stored persistent VAPID keys.');
  }

  webpush.setVapidDetails(
    'mailto:admin@example.com',
    doc.publicKey,
    doc.privateKey
  );
  vapidPublicKey = doc.publicKey;
  console.log('VAPID configured. Public key ready.');
}

// Helper: safely display task text in HTML
function escapeHTML(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

// ==========================================
// 3. Service Worker
// ==========================================

app.get('/sw.js', (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('Service-Worker-Allowed', '/');
  res.send(`
    self.addEventListener('install', event => {
      self.skipWaiting();
    });

    self.addEventListener('activate', event => {
      event.waitUntil(self.clients.claim());
    });

    self.addEventListener('push', event => {
      let data = {
        title: '🔔 To-Do Task Reminder',
        body: 'You have a scheduled to-do task reminder!',
        tag: 'todo-reminder-' + Date.now(),
        url: '/'
      };

      if (event.data) {
        try {
          const parsed = event.data.json();
          data = Object.assign(data, parsed);
        } catch (e) {
          try {
            data.body = event.data.text();
          } catch (e2) {}
        }
      }

      const options = {
        body: data.body,
        icon: 'https://cdn-icons-png.flaticon.com/512/906/906334.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/906/906334.png',
        tag: data.tag || ('reminder-' + Date.now()),
        renotify: true,
        vibrate: [200, 100, 200],
        data: {
          url: data.url || '/'
        }
      };

      event.waitUntil(
        self.registration.showNotification(data.title, options)
      );
    });

    self.addEventListener('notificationclick', event => {
      event.notification.close();
      const targetUrl = (event.notification.data && event.notification.data.url) || '/';

      event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
          for (let client of windowClients) {
            if (client.url && client.url.includes(self.location.origin) && 'focus' in client) {
              return client.focus();
            }
          }
          if (self.clients.openWindow) {
            return self.clients.openWindow(targetUrl);
          }
        })
      );
    });
  `);
});

// ==========================================
// 4. Push API Endpoints
// ==========================================

app.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

app.post('/subscribe', async (req, res) => {
  try {
    const sub = req.body;
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ error: 'Invalid subscription object.' });
    }

    await PushSub.findOneAndUpdate(
      { endpoint: sub.endpoint },
      { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      { upsert: true, new: true }
    );

    console.log('Registered push subscription for client.');
    res.status(201).json({ message: 'Subscribed successfully.' });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/unsubscribe', async (req, res) => {
  try {
    if (req.body && req.body.endpoint) {
      await PushSub.deleteOne({ endpoint: req.body.endpoint });
      console.log('Unregistered push subscription.');
    }
    res.status(200).json({ message: 'Unsubscribed successfully.' });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/send-test-push', async (req, res) => {
  try {
    const subs = await PushSub.find({});
    if (!subs || subs.length === 0) {
      return res.status(400).json({
        error: 'No active push subscriptions found. Please click "Enable Push Notifications" first!'
      });
    }

    const payload = JSON.stringify({
      title: '🔔 Bhoomi\'s To-Do: Push Alert',
      body: 'Web Push Notifications are active and working! You will receive alerts when task reminders are due.',
      tag: 'test-push-' + Date.now(),
      url: '/'
    });

    const results = await Promise.all(subs.map(sub => sendToSubscription(sub, payload)));
    const successCount = results.filter(Boolean).length;

    if (successCount > 0) {
      res.json({ message: `Push notification delivered to ${successCount} browser device(s)!` });
    } else {
      res.status(500).json({ error: 'Failed to deliver notification. Subscription may have expired.' });
    }
  } catch (error) {
    console.error('Send test push error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/notify-task/:id', async (req, res) => {
  try {
    const item = await TodoConstructor.findById(req.params.id);
    if (!item) return res.status(404).send('Task not found.');

    const subs = await PushSub.find({});
    if (subs && subs.length > 0) {
      const payload = JSON.stringify({
        title: '🔔 Task Reminder: ' + item.task,
        body: item.reminderTime
          ? 'Scheduled: ' + new Date(item.reminderTime).toLocaleString()
          : 'Don\'t forget: ' + item.task,
        tag: 'task-' + item._id + '-' + Date.now(),
        url: '/'
      });
      await Promise.all(subs.map(sub => sendToSubscription(sub, payload)));
      await TodoConstructor.updateOne({ _id: item._id }, { reminderSent: true });
    }
    res.redirect('/');
  } catch (error) {
    res.status(500).send('Error triggering reminder: ' + error.message);
  }
});

// ==========================================
// 5. Task Routes & HTML UI
// ==========================================

app.get('/', async (req, res) => {
  try {
    const tasks = await TodoConstructor.find({}).sort({ reminderTime: 1 });
    const totalCount = tasks.length;
    const completedCount = tasks.filter(t => t.isCompleted).length;

    const todoListHTML = tasks.map(item => {
      const isDue = item.reminderTime && new Date(item.reminderTime) <= new Date();
      const reminderFormatted = item.reminderTime ? new Date(item.reminderTime).toLocaleString() : null;

      let badgeHTML = '';
      if (item.reminderTime) {
        if (item.reminderSent) {
          badgeHTML = `<span class="badge badge-sent">🔔 Sent (${escapeHTML(reminderFormatted)})</span>`;
        } else if (isDue) {
          badgeHTML = `<span class="badge badge-due">⏰ Due Now (${escapeHTML(reminderFormatted)})</span>`;
        } else {
          badgeHTML = `<span class="badge badge-scheduled">⏰ ${escapeHTML(reminderFormatted)}</span>`;
        }
      } else {
        badgeHTML = `<span class="badge badge-none">No reminder set</span>`;
      }

      return `
        <div class="task-card ${item.isCompleted ? 'task-completed' : ''}">
          <div class="task-main">
            <span class="task-check-icon">${item.isCompleted ? '✅' : '⚪'}</span>
            <div class="task-info">
              <div class="task-text">${escapeHTML(item.task)}</div>
              <div class="task-meta">${badgeHTML}</div>
            </div>
          </div>

          <div class="task-actions">
            <form action="/toggle-task/${item._id}" method="POST" style="margin:0;">
              <button type="submit" class="btn btn-sm ${item.isCompleted ? 'btn-secondary' : 'btn-done'}">
                ${item.isCompleted ? '↩ Undo' : '✓ Done'}
              </button>
            </form>

            <form action="/notify-task/${item._id}" method="POST" style="margin:0;">
              <button type="submit" class="btn btn-sm btn-notify" title="Send push notification for this task now">
                🔔 Alert Now
              </button>
            </form>

            <form action="/delete-task/${item._id}" method="POST" style="margin:0;">
              <button type="submit" class="btn btn-sm btn-delete">
                🗑 Delete
              </button>
            </form>
          </div>
        </div>
      `;
    }).join('');

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bhoomi's To-Do List with Push Notifications</title>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
        <style>
          :root {
            --bg-color: #0f172a;
            --card-bg: #1e293b;
            --card-border: #334155;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --primary: #6366f1;
            --primary-hover: #4f46e5;
            --success: #10b981;
            --success-hover: #059669;
            --danger: #ef4444;
            --danger-hover: #dc2626;
            --warning: #f59e0b;
            --radius-lg: 16px;
            --radius-md: 10px;
            --radius-sm: 6px;
            --shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
          }

          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }

          body {
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            color: var(--text-main);
            min-height: 100vh;
            padding: 30px 16px;
            display: flex;
            justify-content: center;
            align-items: flex-start;
          }

          .container {
            width: 100%;
            max-width: 640px;
            margin: 0 auto;
          }

          /* Header */
          .header {
            text-align: center;
            margin-bottom: 24px;
          }

          .header h1 {
            font-family: 'Outfit', sans-serif;
            font-size: 2rem;
            font-weight: 700;
            background: linear-gradient(135deg, #818cf8 0%, #c084fc 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 6px;
          }

          .header p {
            color: var(--text-muted);
            font-size: 0.95rem;
          }

          /* Card common */
          .card {
            background: var(--card-bg);
            border: 1px solid var(--card-border);
            border-radius: var(--radius-lg);
            padding: 22px;
            box-shadow: var(--shadow);
            margin-bottom: 20px;
            backdrop-filter: blur(10px);
          }

          /* Notification Control Panel */
          .push-panel {
            background: linear-gradient(135deg, #1e293b 0%, #2e2652 100%);
            border: 1px solid #4338ca;
            position: relative;
            overflow: hidden;
          }

          .push-panel::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899);
          }

          .push-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            flex-wrap: wrap;
            gap: 10px;
          }

          .push-title {
            font-family: 'Outfit', sans-serif;
            font-size: 1.1rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .status-pill {
            font-size: 0.8rem;
            font-weight: 600;
            padding: 4px 10px;
            border-radius: 20px;
            display: inline-flex;
            align-items: center;
            gap: 6px;
          }

          .status-active {
            background: rgba(16, 185, 129, 0.2);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.4);
          }

          .status-inactive {
            background: rgba(148, 163, 184, 0.2);
            color: #94a3b8;
            border: 1px solid rgba(148, 163, 184, 0.4);
          }

          .status-blocked {
            background: rgba(239, 68, 68, 0.2);
            color: #f87171;
            border: 1px solid rgba(239, 68, 68, 0.4);
          }

          .push-desc {
            color: var(--text-muted);
            font-size: 0.88rem;
            line-height: 1.45;
            margin-bottom: 16px;
          }

          .push-btn-row {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
          }

          /* Buttons */
          .btn {
            font-family: 'Inter', sans-serif;
            font-size: 0.9rem;
            font-weight: 500;
            padding: 10px 16px;
            border-radius: var(--radius-sm);
            border: none;
            cursor: pointer;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            text-decoration: none;
          }

          .btn:active {
            transform: scale(0.98);
          }

          .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none !important;
          }

          .btn-primary {
            background: var(--primary);
            color: white;
          }
          .btn-primary:hover:not(:disabled) {
            background: var(--primary-hover);
          }

          .btn-success {
            background: var(--success);
            color: white;
          }
          .btn-success:hover:not(:disabled) {
            background: var(--success-hover);
          }

          .btn-secondary {
            background: #334155;
            color: #f1f5f9;
          }
          .btn-secondary:hover:not(:disabled) {
            background: #475569;
          }

          .btn-test {
            background: #4f46e5;
            color: white;
          }
          .btn-test:hover:not(:disabled) {
            background: #4338ca;
          }

          .btn-sm {
            padding: 6px 10px;
            font-size: 0.8rem;
          }

          .btn-done {
            background: rgba(16, 185, 129, 0.15);
            color: #34d399;
            border: 1px solid rgba(16, 185, 129, 0.4);
          }
          .btn-done:hover {
            background: #10b981;
            color: white;
          }

          .btn-notify {
            background: rgba(99, 102, 241, 0.15);
            color: #a5b4fc;
            border: 1px solid rgba(99, 102, 241, 0.4);
          }
          .btn-notify:hover {
            background: #6366f1;
            color: white;
          }

          .btn-delete {
            background: rgba(239, 68, 68, 0.15);
            color: #f87171;
            border: 1px solid rgba(239, 68, 68, 0.4);
          }
          .btn-delete:hover {
            background: #ef4444;
            color: white;
          }

          /* Form Styles */
          .form-group {
            margin-bottom: 14px;
          }

          .form-label {
            display: block;
            font-size: 0.88rem;
            font-weight: 500;
            color: #cbd5e1;
            margin-bottom: 6px;
          }

          .form-input {
            width: 100%;
            padding: 11px 14px;
            background: #0f172a;
            border: 1px solid var(--card-border);
            border-radius: var(--radius-sm);
            color: white;
            font-family: inherit;
            font-size: 0.95rem;
            outline: none;
            transition: border-color 0.2s;
          }

          .form-input:focus {
            border-color: var(--primary);
            box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.25);
          }

          /* Quick presets for time */
          .preset-row {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
            margin-top: 8px;
          }

          .preset-chip {
            background: #334155;
            color: #cbd5e1;
            border: 1px solid #475569;
            font-size: 0.75rem;
            padding: 4px 9px;
            border-radius: 12px;
            cursor: pointer;
            transition: background 0.2s;
          }
          .preset-chip:hover {
            background: #475569;
            color: white;
          }

          /* Task list header */
          .list-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 14px;
          }

          .list-header h2 {
            font-family: 'Outfit', sans-serif;
            font-size: 1.25rem;
            font-weight: 600;
          }

          .count-pill {
            background: #334155;
            color: #cbd5e1;
            font-size: 0.8rem;
            padding: 3px 9px;
            border-radius: 12px;
          }

          /* Task Cards */
          .task-card {
            background: #1e293b;
            border: 1px solid var(--card-border);
            border-radius: var(--radius-md);
            padding: 14px 16px;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            transition: all 0.2s;
          }

          .task-card:hover {
            border-color: #475569;
            transform: translateY(-1px);
          }

          .task-completed {
            opacity: 0.65;
            background: #151e2e;
          }

          .task-completed .task-text {
            text-decoration: line-through;
            color: var(--text-muted);
          }

          .task-main {
            display: flex;
            align-items: flex-start;
            gap: 12px;
            flex: 1;
            min-width: 0;
          }

          .task-check-icon {
            font-size: 1.1rem;
            margin-top: 2px;
          }

          .task-info {
            flex: 1;
            min-width: 0;
          }

          .task-text {
            font-size: 0.95rem;
            font-weight: 500;
            color: var(--text-main);
            overflow-wrap: anywhere;
            line-height: 1.4;
          }

          .task-meta {
            margin-top: 5px;
          }

          .badge {
            font-size: 0.75rem;
            font-weight: 500;
            padding: 2px 7px;
            border-radius: 4px;
            display: inline-block;
          }

          .badge-scheduled {
            background: rgba(99, 102, 241, 0.2);
            color: #a5b4fc;
            border: 1px solid rgba(99, 102, 241, 0.4);
          }

          .badge-due {
            background: rgba(245, 158, 11, 0.2);
            color: #fcd34d;
            border: 1px solid rgba(245, 158, 11, 0.4);
            animation: pulse 1.5s infinite;
          }

          .badge-sent {
            background: rgba(16, 185, 129, 0.2);
            color: #6ee7b7;
            border: 1px solid rgba(16, 185, 129, 0.4);
          }

          .badge-none {
            color: #64748b;
          }

          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
          }

          .task-actions {
            display: flex;
            gap: 6px;
            align-items: center;
            flex-wrap: wrap;
          }

          .empty-state {
            text-align: center;
            padding: 35px 20px;
            color: var(--text-muted);
          }

          .empty-state-icon {
            font-size: 2.5rem;
            margin-bottom: 10px;
            opacity: 0.6;
          }
        </style>
      </head>
      <body>
        <div class="container">

          <!-- Header -->
          <div class="header">
            <h1>📝 Bhoomi's To-Do List</h1>
            <p>Task Manager with Web Push Notification Reminders</p>
          </div>

          <!-- Push Notifications Card -->
          <div class="card push-panel">
            <div class="push-header">
              <div class="push-title">
                🔔 Web Push Notifications
              </div>
              <div id="statusPill" class="status-pill status-inactive">
                Checking...
              </div>
            </div>

            <p id="notificationStatus" class="push-desc">
              Initializing notification capabilities...
            </p>

            <div class="push-btn-row">
              <button
                id="notifyBtn"
                type="button"
                onclick="togglePush()"
                class="btn btn-primary"
              >
                🔔 Enable Notifications
              </button>

              <button
                id="testBtn"
                type="button"
                onclick="sendTestPush()"
                class="btn btn-test"
                style="display:none;"
              >
                🧪 Send Test Push
              </button>
            </div>
          </div>

          <!-- Add Task Card -->
          <div class="card">
            <form action="/add-task" method="POST">
              <div class="form-group">
                <label class="form-label" for="taskInput">Task Title</label>
                <input
                  id="taskInput"
                  type="text"
                  name="task"
                  placeholder="What needs to be done?"
                  required
                  class="form-input"
                  autofocus
                >
              </div>

              <div class="form-group">
                <label class="form-label" for="reminderTime">Reminder Date & Time (Optional)</label>
                <input
                  type="datetime-local"
                  id="reminderTime"
                  name="reminderTime"
                  class="form-input"
                >
                <div class="preset-row">
                  <span class="preset-chip" onclick="setQuickTime(1)">+1 min</span>
                  <span class="preset-chip" onclick="setQuickTime(5)">+5 min</span>
                  <span class="preset-chip" onclick="setQuickTime(30)">+30 min</span>
                  <span class="preset-chip" onclick="setQuickTime(60)">+1 hour</span>
                  <span class="preset-chip" onclick="setTomorrowMorning()">Tomorrow 9 AM</span>
                  <span class="preset-chip" onclick="document.getElementById('reminderTime').value=''">Clear</span>
                </div>
              </div>

              <button type="submit" class="btn btn-success" style="width: 100%; margin-top: 6px;">
                ➕ Add Task
              </button>
            </form>
          </div>

          <!-- Tasks List -->
          <div>
            <div class="list-header">
              <h2>Your Tasks</h2>
              <span class="count-pill">${totalCount} Task${totalCount === 1 ? '' : 's'} (${completedCount} completed)</span>
            </div>

            ${todoListHTML || `
              <div class="card empty-state">
                <div class="empty-state-icon">📋</div>
                <p>Your to-do list is empty!</p>
                <small style="color:#64748b;">Add your first task above and set a reminder to test push notifications.</small>
              </div>
            `}
          </div>

        </div>

        <script>
          const statusEl = document.getElementById('notificationStatus');
          const statusPill = document.getElementById('statusPill');
          const btn = document.getElementById('notifyBtn');
          const testBtn = document.getElementById('testBtn');

          function urlBase64ToUint8Array(base64String) {
            const padding = '='.repeat((4 - base64String.length % 4) % 4);
            const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
            const raw = atob(base64);
            const output = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
            return output;
          }

          function pushSupported() {
            return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
          }

          async function getRegistration() {
            return navigator.serviceWorker.register('/sw.js', { scope: '/' });
          }

          function setQuickTime(minutes) {
            const target = new Date(Date.now() + minutes * 60 * 1000);
            const pad = function(n) { return String(n).padStart(2, '0'); };
            const y = target.getFullYear();
            const m = pad(target.getMonth() + 1);
            const d = pad(target.getDate());
            const hh = pad(target.getHours());
            const mm = pad(target.getMinutes());
            document.getElementById('reminderTime').value = y + '-' + m + '-' + d + 'T' + hh + ':' + mm;
          }

          function setTomorrowMorning() {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(9, 0, 0, 0);
            const pad = function(n) { return String(n).padStart(2, '0'); };
            const y = tomorrow.getFullYear();
            const m = pad(tomorrow.getMonth() + 1);
            const d = pad(tomorrow.getDate());
            document.getElementById('reminderTime').value = y + '-' + m + '-' + d + 'T09:00';
          }

          async function refreshUI() {
            if (!pushSupported()) {
              btn.disabled = true;
              testBtn.style.display = 'none';
              statusPill.className = 'status-pill status-blocked';
              statusPill.textContent = 'Not Supported';
              statusEl.textContent = 'Push notifications are not supported in this browser. Please use Chrome, Edge, or Firefox.';
              return;
            }

            if (Notification.permission === 'denied') {
              btn.disabled = true;
              testBtn.style.display = 'none';
              statusPill.className = 'status-pill status-blocked';
              statusPill.textContent = 'Blocked';
              statusEl.textContent = 'Notifications are blocked in browser settings. Click the site settings/lock icon in your address bar and allow notifications.';
              return;
            }

            try {
              const reg = await getRegistration();
              const sub = await reg.pushManager.getSubscription();

              if (sub) {
                btn.className = 'btn btn-secondary';
                btn.textContent = '🔕 Disable Notifications';
                testBtn.style.display = 'inline-flex';
                statusPill.className = 'status-pill status-active';
                statusPill.textContent = 'Active';
                statusEl.textContent = 'Push notifications are ACTIVE! You will receive alerts when task reminders are due, even if this browser tab is closed.';

                // Keep subscription synced with server
                const subData = sub.toJSON ? sub.toJSON() : JSON.parse(JSON.stringify(sub));
                fetch('/subscribe', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(subData)
                }).catch(() => {});
              } else {
                btn.className = 'btn btn-primary';
                btn.textContent = '🔔 Enable Notifications';
                testBtn.style.display = 'none';
                statusPill.className = 'status-pill status-inactive';
                statusPill.textContent = 'Disabled';
                statusEl.textContent = 'Enable push notifications to receive reminders when your tasks are due.';
              }
            } catch (err) {
              console.error('refreshUI error:', err);
              statusEl.textContent = 'Error checking notification status: ' + err.message;
            }
          }

          async function togglePush() {
            try {
              btn.disabled = true;
              const reg = await getRegistration();
              const existing = await reg.pushManager.getSubscription();

              if (existing) {
                await fetch('/unsubscribe', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ endpoint: existing.endpoint })
                });
                await existing.unsubscribe();
                await refreshUI();
                return;
              }

              const permission = await Notification.requestPermission();
              if (permission !== 'granted') {
                await refreshUI();
                return;
              }

              const keyRes = await fetch('/vapid-public-key');
              const keyData = await keyRes.json();
              const publicKey = keyData.publicKey;

              const sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
              });

              const subData = sub.toJSON ? sub.toJSON() : JSON.parse(JSON.stringify(sub));
              const res = await fetch('/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(subData)
              });

              if (!res.ok) throw new Error('Server rejected push subscription.');

              await refreshUI();
            } catch (error) {
              console.error('togglePush error:', error);
              statusEl.textContent = 'Could not enable notifications: ' + error.message;
            } finally {
              btn.disabled = false;
            }
          }

          async function sendTestPush() {
            try {
              testBtn.disabled = true;
              testBtn.textContent = '⏳ Sending...';
              const res = await fetch('/send-test-push', { method: 'POST' });
              const data = await res.json();
              if (res.ok) {
                statusEl.textContent = '✅ ' + (data.message || 'Test notification sent! Check your desktop notification center.');
              } else {
                statusEl.textContent = '❌ ' + (data.error || 'Failed to send test notification.');
              }
            } catch (err) {
              statusEl.textContent = '❌ Error sending test push: ' + err.message;
            } finally {
              testBtn.disabled = false;
              testBtn.textContent = '🧪 Send Test Push';
            }
          }

          // Initialize UI
          refreshUI();
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error rendering tasks: ' + error.message);
  }
});

app.post('/add-task', async (req, res) => {
  try {
    const { task, reminderTime } = req.body;
    if (!task || !task.trim()) {
      return res.status(400).send('Please enter a task description.');
    }

    let parsedTime = null;
    if (reminderTime) {
      const d = new Date(reminderTime);
      if (!isNaN(d.getTime())) {
        parsedTime = d;
      }
    }

    const newTodo = new TodoConstructor({
      task: task.trim(),
      reminderTime: parsedTime,
      reminderSent: false,
      isCompleted: false
    });

    await newTodo.save();
    setImmediate(processDueReminders);
    res.redirect('/');
  } catch (error) {
    res.status(500).send('Error adding task: ' + error.message);
  }
});

app.post('/toggle-task/:id', async (req, res) => {
  try {
    const item = await TodoConstructor.findById(req.params.id);
    if (!item) return res.status(404).send('Task not found.');

    item.isCompleted = !item.isCompleted;
    if (!item.isCompleted && item.reminderTime && new Date(item.reminderTime) > new Date()) {
      item.reminderSent = false;
    }
    await item.save();
    res.redirect('/');
  } catch (error) {
    res.status(500).send('Error toggling task: ' + error.message);
  }
});

app.post('/delete-task/:id', async (req, res) => {
  try {
    await TodoConstructor.findByIdAndDelete(req.params.id);
    res.redirect('/');
  } catch (error) {
    res.status(500).send('Error deleting task: ' + error.message);
  }
});

// ==========================================
// 6. Push Notification Scheduler
// ==========================================

async function sendToSubscription(sub, payload) {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      payload
    );
    return true;
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      console.log('Push subscription expired/unregistered (404/410). Removing endpoint.');
      await PushSub.deleteOne({ endpoint: sub.endpoint });
    } else {
      console.error('Push send failed:', error.statusCode || '', error.message);
    }
    return false;
  }
}

let schedulerRunning = false;

async function processDueReminders() {
  if (schedulerRunning) return;
  schedulerRunning = true;

  try {
    const subs = await PushSub.find({});
    if (!subs || subs.length === 0) return;

    const dueTasks = await TodoConstructor.find({
      reminderTime: { $lte: new Date(), $ne: null },
      reminderSent: false,
      isCompleted: false
    });

    for (const item of dueTasks) {
      const claimed = await TodoConstructor.findOneAndUpdate(
        { _id: item._id, reminderSent: false },
        { reminderSent: true }
      );
      if (!claimed) continue;

      console.log('⏰ Reminder triggered for: "' + item.task + '" -> Sending push to ' + subs.length + ' client(s)');

      const payload = JSON.stringify({
        title: '🔔 To-Do Reminder: ' + item.task,
        body: 'Scheduled task is due: ' + item.task,
        tag: 'task-' + item._id,
        url: '/'
      });

      const results = await Promise.all(subs.map(sub => sendToSubscription(sub, payload)));

      if (!results.some(Boolean)) {
        await TodoConstructor.updateOne({ _id: item._id }, { reminderSent: false });
      }
    }
  } catch (error) {
    console.error('Reminder scheduler error:', error);
  } finally {
    schedulerRunning = false;
  }
}

// ==========================================
// 7. Server Initialization
// ==========================================

async function start() {
  try {
    // Attempt MongoDB connection with 1.5s timeout; fallback gracefully if MongoDB is not running
    try {
      await mongoose.connect('mongodb://127.0.0.1:27017/todo_db', {
        serverSelectionTimeoutMS: 1500
      });
      isMongoConnected = true;
      console.log('✅ Connected to MongoDB at mongodb://127.0.0.1:27017/todo_db');
    } catch (dbErr) {
      isMongoConnected = false;
      console.log('ℹ️ MongoDB not detected on localhost:27017.');
      console.log('📦 Using persistent local file store (todo_data.json) - All push notification and todo features are 100% operational!');
    }

    await initVapid();

    // Check reminders every 5 seconds
    setInterval(processDueReminders, 5000);
    processDueReminders();

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      console.log('🚀 To-Do App with Push Notifications is running at http://localhost:' + PORT);
    });
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

start();