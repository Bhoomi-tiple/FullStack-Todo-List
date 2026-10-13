
const express = require('express');
const mongoose = require('mongoose');

const app = express();

app.use(express.urlencoded({ extended: true }));

// 1. Connect to MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/todo_db')
  .then(() => console.log('Connected to To-Do Database successfully!'))
  .catch(err => console.error('Database connection error:', err));

// 2. Database Schema
const TodoSchema = new mongoose.Schema({
  task: { type: String, required: true },
  isCompleted: { type: Boolean, default: false },
  reminderTime: { type: Date, default: null },
  reminderSent: { type: Boolean, default: false }
});

const Todo = mongoose.model('Todo', TodoSchema);

// Helper: safely display task text in HTML
function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

// 3. Display all tasks
app.get('/', async (req, res) => {
  try {
    const tasks = await Todo.find({}).sort({ reminderTime: 1 });

    const todoListHTML = tasks.map(item => `
      <div style="
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:12px;
        background:white;
        padding:12px 15px;
        margin-bottom:10px;
        border-radius:6px;
        box-shadow:0 1px 3px rgba(0,0,0,0.05);
      ">
        <div style="flex:1; min-width:0;">
          <div style="
            overflow-wrap:anywhere;
            text-decoration:${item.isCompleted ? 'line-through' : 'none'};
            color:${item.isCompleted ? '#a0aec0' : '#2d3748'};
          ">
            ${escapeHTML(item.task)}
          </div>

          <small style="color:#718096;">
            ${item.reminderTime
              ? '🔔 ' + escapeHTML(item.reminderTime.toLocaleString())
              : 'No reminder set'}
          </small>
        </div>

        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <form action="/toggle-task/${item._id}" method="POST">
            <button type="submit">
              ${item.isCompleted ? '↩ Undo' : '✓ Done'}
            </button>
          </form>

          <form action="/delete-task/${item._id}" method="POST">
            <button type="submit">🗑 Delete</button>
          </form>
        </div>
      </div>
    `).join('');

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>Bhoomi's To-Do List</title>
      </head>

      <body style="
        font-family:Arial,sans-serif;
        background:#f7fafc;
        padding:40px 20px;
        margin:0;
      ">
        <div style="max-width:550px; margin:0 auto;">

          <h2 style="text-align:center; color:#2d3748;">
            📝 Bhoomi's To-Do List
          </h2>

          <button
            type="button"
            onclick="enableNotifications()"
            style="display:block; margin:0 auto 20px; padding:10px 15px;"
          >
            🔔 Enable Notifications
          </button>

          <p id="notificationStatus" style="text-align:center;"></p>

          <div style="
            background:white;
            padding:20px;
            border-radius:8px;
            margin-bottom:25px;
          ">
            <form
              action="/add-task"
              method="POST"
              style="display:flex; flex-direction:column; gap:10px;"
            >
              <input
                type="text"
                name="task"
                placeholder="What needs to be done?"
                required
                style="padding:10px;"
              >

              <label for="reminderTime">Reminder date and time:</label>

              <input
                type="datetime-local"
                id="reminderTime"
                name="reminderTime"
                required
                style="padding:10px;"
              >

              <button
                type="submit"
                style="
                  background:#38a169;
                  color:white;
                  border:none;
                  padding:10px;
                  font-size:16px;
                  cursor:pointer;
                  border-radius:4px;
                "
              >
                Add Task
              </button>
            </form>
          </div>

          <h3>Your Tasks</h3>

          <div>
            ${todoListHTML || `
              <p style="text-align:center; color:#a0aec0;">
                Your to-do list is empty!
              </p>
            `}
          </div>
        </div>

        <script>
          async function enableNotifications() {
            const status = document.getElementById('notificationStatus');

            if (!('Notification' in window)) {
              status.textContent = 'Your browser does not support notifications.';
              return;
            }

            const permission = await Notification.requestPermission();

            if (permission === 'granted') {
              status.textContent = 'Notifications enabled! Keep this page open.';
              checkReminders();
            } else {
              status.textContent = 'Please allow notifications in browser settings.';
            }
          }

          async function checkReminders() {
            if (!('Notification' in window)) return;
            if (Notification.permission !== 'granted') return;

            try {
              const response = await fetch('/due-reminders');

              if (!response.ok) {
                console.error('Could not fetch reminders.');
                return;
              }

              const reminders = await response.json();

              for (const item of reminders) {
                try {
                  new Notification('🔔 Task Reminder', {
                    body: item.task
                  });

                  // Mark as sent only after creating the notification.
                  await fetch('/reminder-sent/' + item.id, {
                    method: 'POST'
                  });
                } catch (error) {
                  console.error('Could not show notification:', error);
                }
              }
            } catch (error) {
              console.error('Reminder check failed:', error);
            }
          }

          // Check immediately, then every 5 seconds.
          checkReminders();
          setInterval(checkReminders, 5000);
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading tasks: ' + error.message);
  }
});

// 4. Add a new task
app.post('/add-task', async (req, res) => {
  try {
    const { task, reminderTime } = req.body;
    const parsedTime = new Date(reminderTime);

    if (!task || !reminderTime || isNaN(parsedTime.getTime())) {
      return res.status(400).send('Please enter a valid task and reminder time.');
    }

    const newTodo = new Todo({
      task,
      reminderTime: parsedTime,
      reminderSent: false
    });

    await newTodo.save();
    res.redirect('/');
  } catch (error) {
    res.status(500).send('Error adding task: ' + error.message);
  }
});

// 5. Mark task as done or undo
app.post('/toggle-task/:id', async (req, res) => {
  try {
    const item = await Todo.findById(req.params.id);

    if (!item) {
      return res.status(404).send('Task not found.');
    }

    item.isCompleted = !item.isCompleted;
    await item.save();

    res.redirect('/');
  } catch (error) {
    res.status(500).send('Error updating task: ' + error.message);
  }
});

// 6. Delete a task
app.post('/delete-task/:id', async (req, res) => {
  try {
    await Todo.findByIdAndDelete(req.params.id);
    res.redirect('/');
  } catch (error) {
    res.status(500).send('Error removing task: ' + error.message);
  }
});

// 7. Find reminders that are due
app.get('/due-reminders', async (req, res) => {
  try {
    const now = new Date();

    const reminders = await Todo.find({
      reminderTime: { $lte: now, $ne: null },
      reminderSent: false,
      isCompleted: false
    });

    res.json(reminders.map(item => ({
      id: item._id,
      task: item.task
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Mark a reminder as sent
app.post('/reminder-sent/:id', async (req, res) => {
  try {
    await Todo.findOneAndUpdate(
      {
        _id: req.params.id,
        reminderSent: false
      },
      { reminderSent: true }
    );

    res.sendStatus(200);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Start server after database connection
mongoose.connection.once('open', () => {
  app.listen(3000, () => {
    console.log('To-Do App running at http://localhost:3000');
  });
});
