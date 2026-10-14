# ✅ To-Do App with Push Notifications

A task management web application built using **Node.js, Express.js, MongoDB, and Web Push Notifications**. The application allows users to manage their daily tasks, schedule reminders, and receive browser notifications when tasks are due. It also includes a JSON file-based fallback storage mechanism to keep the application operational when MongoDB is unavailable.

## ✨ Features

- 📝 **Task Management:** Create and manage daily tasks.
- ⏰ **Scheduled Reminders:** Set reminder dates and times for tasks.
- 🔔 **Browser Push Notifications:** Receive notifications when reminders are triggered.
- ✅ **Task Completion Tracking:** Track completed and pending tasks.
- 🗄️ **MongoDB Integration:** Store application data using MongoDB and Mongoose.
- 📁 **Fallback Storage:** Use a local JSON file when MongoDB is unavailable.
- 🔐 **VAPID Authentication:** Configure authenticated web push notifications.
- 🌐 **Local Web Access:** Run the application locally through a browser.

## 🛠️ Tech Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| Express.js | Backend server and HTTP handling |
| MongoDB | Primary database |
| Mongoose | MongoDB object modeling |
| JavaScript | Application logic |
| Web Push API | Browser push notifications |
| `web-push` | Sending push notifications |
| JSON | Fallback local data storage |

## 📁 Project Structure

```text
todo-app/
├── todo_app.js      # Main application and server logic
├── todo_data.json   # Persistent fallback data storage
└── README.md        # Project documentation
```

## ⚙️ Prerequisites

Before running the application, install:

- [Node.js](https://nodejs.org/)
- [MongoDB Community Server](https://www.mongodb.com/try/download/community)
- A modern browser that supports push notifications and service workers

## 🚀 Installation and Setup

### 1. Install dependencies

Open a terminal in the project directory and run:

```bash
npm install express mongoose web-push
```

### 2. Start MongoDB

Ensure that the local MongoDB service is running.

The application connects to:

```text
mongodb://127.0.0.1:27017/todo_db
```

### 3. Configure VAPID keys

The application uses VAPID keys for Web Push authentication.

To generate a key pair, run:

```bash
npx web-push generate-vapid-keys
```

Configure the generated public and private keys in the application as required. Keep the private key confidential.

### 4. Run the application

Start the server using:

```bash
node todo_app.js
```

Once the server starts, open the application in your browser:

**http://localhost:3000**

Allow browser notification permission when prompted.

## 🗄️ Database and Fallback Storage

The application supports two storage modes.

### MongoDB — Primary Storage

- Connects to the local MongoDB database `todo_db`.
- Uses Mongoose to communicate with MongoDB.
- Stores application data when the database connection is successful.

### JSON File — Fallback Storage

- Uses `todo_data.json` when MongoDB is unavailable.
- Allows the application to continue operating through local file-based storage.
- Provides an alternative to database access when the local MongoDB service is not running.

### How the Fallback Mechanism Works

1. The application attempts to connect to MongoDB.
2. It waits up to 1.5 seconds for the connection.
3. If the connection succeeds, MongoDB is used.
4. If the connection fails, the application switches to the JSON file store.

**Note:** Data stored in MongoDB and data stored in the JSON file are separate unless synchronization is explicitly implemented.

## 🔔 How Push Notifications Work

1. The user creates a task and schedules a reminder.
2. The application stores the task and its reminder information.
3. The server checks for reminders that are due.
4. When a reminder is triggered, the server attempts to send a push notification to registered browser subscriptions.
5. The browser receives and displays the notification when browser permissions, service worker registration, and system settings allow it.

## 🔒 Security

- Keep VAPID private keys out of public repositories.
- Never commit sensitive push subscription details.
- Request notification permission before registering browser subscriptions.
- Use environment variables for sensitive configuration in production.
- Avoid exposing private database credentials.

## 🎓 Learning Outcomes

This project demonstrates practical implementation of:

- Backend development using Node.js and Express.js.
- Database integration using MongoDB and Mongoose.
- JSON-based file persistence.
- Task reminders and scheduling logic.
- Browser push notifications and service workers.
- Error handling and fallback storage mechanisms.

## 🔮 Future Enhancements

- Add task editing and deletion.
- Introduce task categories and priorities.
- Support recurring reminders.
- Add search and filtering.
- Improve mobile responsiveness.
- Implement user authentication.
- Deploy the application for online access.

## 👩‍💻 Project Details

- **Project Name:** To-Do App with Push Notifications
- **Project Type:** Web Application
- **Backend:** Node.js and Express.js
- **Database:** MongoDB
- **Fallback Storage:** JSON file
- **Notification System:** Web Push API

---

*Developed as a practical project to explore task management, backend development, persistent data storage, and browser push notifications.*
