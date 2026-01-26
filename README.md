# Bentree OMS (Order Management System)

A comprehensive, mobile-responsive Order Management System built with **React** and **Firebase**. This application is designed to streamline order processing, inventory tracking, and sales reporting for retail businesses with both Online and In-Store operations.

### 📦 Order Management
* **New Order Entry**: Unified interface for creating Online and Store orders with real-time stock validation.
* **Duplicate Detection**: Automatic warning system for duplicate phone numbers across pending orders.
* **Order Workflow**:
    * **Primary/Pending**: Manage incoming orders, track call attempts, and edit details.
    * **Confirmed**: Handle dispatch, delivery confirmation, and return processing.
    * **Dispatch**: Streamlined view for printing labels and tracking shipments.
    * **Returns & Exchanges**: Dedicated logic for handling returns (with delivery fee tracking) and product exchanges (with price adjustments).

### 📊 Inventory & Stock
* **Real-time Tracking**: Auto-deduction of stock upon order creation.
* **CSV Import/Export**: Bulk upload products via CSV and export current stock reports.
* **Variable Products**: Support for size-based inventory (S, M, L, XL, etc.) or single items.
* **Location Management**: Track product locations (e.g., Shelf A, Row 2).

### 📈 Sales & Reporting
* **Dashboard**: Monthly profit calculation, expense tracking, and revenue summaries.
* **Platform Filtering**: Filter sales reports by source (Facebook, Instagram, Website, etc.).
* **Store vs. Online**: Separate views for analyzing different sales channels.

### 🔐 Security & Auth
* **Authentication**: Secure Email/Password login and Google Sign-In.
* **User Tracking**: Tracks who added, edited, or deleted an order (audit logs).

---

## 🛠️ Tech Stack

* **Frontend**: React.js (Vite)
* **Styling**: Tailwind CSS
* **Database**: Firebase Firestore (NoSQL)
* **Authentication**: Firebase Auth
* **Icons**: Lucide React

---

## ⚙️ Installation & Setup

Follow these steps to run the project locally.

src/
├── components/          # All UI Screens
│   ├── Login.jsx        # Auth Screens
│   ├── NewOrderForm.jsx # Order Entry
│   ├── InventoryTab.jsx # Stock Management
│   ├── PrimaryOrders.jsx# Order Processing
│   └── ...
├── firebase.js          # DB Configuration
├── App.js               # Main Router & Layout
└── index.css            # Tailwind Imports