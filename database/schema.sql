CREATE DATABASE IF NOT EXISTS medistore CHARACTER SET utf8mb4;
USE medistore;

CREATE TABLE users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  phone VARCHAR(20),
  password VARCHAR(255) NOT NULL,
  role ENUM('admin','pharmacist','customer') NOT NULL DEFAULT 'customer',
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_role (role)
);

CREATE TABLE categories (
  category_id INT AUTO_INCREMENT PRIMARY KEY,
  category_name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE medicines (
  medicine_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  generic_name VARCHAR(150),
  brand VARCHAR(100),
  category_id INT,
  manufacturer VARCHAR(150),
  description TEXT,
  dosage_form VARCHAR(50),
  strength VARCHAR(50),
  mrp DECIMAL(10,2) NOT NULL,
  selling_price DECIMAL(10,2) NOT NULL,
  prescription_required BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(category_id) ON DELETE SET NULL,
  INDEX idx_med_name (name), INDEX idx_med_category (category_id), INDEX idx_med_mfr (manufacturer),
  CHECK (selling_price <= mrp)
);

CREATE TABLE suppliers (
  supplier_id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_name VARCHAR(150) NOT NULL,
  company_name VARCHAR(150),
  contact_person VARCHAR(100),
  phone VARCHAR(20),
  email VARCHAR(150),
  address TEXT,
  gst_number VARCHAR(30),
  status ENUM('active','inactive') NOT NULL DEFAULT 'active'
);

CREATE TABLE medicine_batches (
  batch_id INT AUTO_INCREMENT PRIMARY KEY,
  medicine_id INT NOT NULL,
  supplier_id INT,
  batch_number VARCHAR(50) NOT NULL,
  manufacturing_date DATE,
  expiry_date DATE NOT NULL,
  purchase_price DECIMAL(10,2) NOT NULL,
  selling_price DECIMAL(10,2) NOT NULL,
  quantity INT NOT NULL DEFAULT 0,
  reorder_level INT NOT NULL DEFAULT 10,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (medicine_id) REFERENCES medicines(medicine_id) ON DELETE CASCADE,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id) ON DELETE SET NULL,
  UNIQUE KEY uq_med_batch (medicine_id, batch_number),
  INDEX idx_expiry (expiry_date),
  CHECK (quantity >= 0)
);

CREATE TABLE inventory_transactions (
  transaction_id INT AUTO_INCREMENT PRIMARY KEY,
  medicine_id INT NOT NULL,
  batch_id INT NOT NULL,
  transaction_type ENUM('PURCHASE','SALE','RETURN','EXPIRED','DAMAGED','ADJUSTMENT') NOT NULL,
  quantity INT NOT NULL COMMENT 'signed: + adds stock, - removes stock',
  reference_id INT,
  transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  remarks VARCHAR(255),
  FOREIGN KEY (medicine_id) REFERENCES medicines(medicine_id),
  FOREIGN KEY (batch_id) REFERENCES medicine_batches(batch_id),
  INDEX idx_tx_type (transaction_type), INDEX idx_tx_date (transaction_date)
);

CREATE TABLE carts (
  cart_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(user_id) ON DELETE CASCADE
);

CREATE TABLE cart_items (
  cart_item_id INT AUTO_INCREMENT PRIMARY KEY,
  cart_id INT NOT NULL,
  medicine_id INT NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  FOREIGN KEY (cart_id) REFERENCES carts(cart_id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES medicines(medicine_id) ON DELETE CASCADE,
  UNIQUE KEY uq_cart_med (cart_id, medicine_id)
);

CREATE TABLE orders (
  order_id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  order_status ENUM('Pending','Confirmed','Processing','Packed','Dispatched','Out for Delivery','Delivered','Cancelled') NOT NULL DEFAULT 'Pending',
  delivery_address TEXT NOT NULL,
  delivery_phone VARCHAR(20) NULL,
  notes VARCHAR(500) NULL,
  prescription_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES users(user_id),
  INDEX idx_order_customer (customer_id), INDEX idx_order_status (order_status)
);

CREATE TABLE order_items (
  order_item_id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  medicine_id INT NOT NULL,
  batch_id INT NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES medicines(medicine_id),
  FOREIGN KEY (batch_id) REFERENCES medicine_batches(batch_id)
);

-- Phase 4: one row per status change, powers the order tracking timeline
CREATE TABLE order_status_history (
  history_id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  status ENUM('Pending','Confirmed','Processing','Packed','Dispatched','Out for Delivery','Delivered','Cancelled') NOT NULL,
  changed_by INT NULL,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE,
  FOREIGN KEY (changed_by) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_osh_order (order_id)
);

CREATE TABLE purchases (
  purchase_id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  purchase_date DATE NOT NULL,
  status ENUM('Draft','Confirmed','Cancelled') NOT NULL DEFAULT 'Draft',
  invoice_number VARCHAR(50) NULL,            -- Phase 5: supplier's invoice / bill number
  notes VARCHAR(500) NULL,
  created_by INT NULL,
  confirmed_by INT NULL,
  confirmed_at TIMESTAMP NULL,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id),
  FOREIGN KEY (created_by) REFERENCES users(user_id) ON DELETE SET NULL,
  FOREIGN KEY (confirmed_by) REFERENCES users(user_id) ON DELETE SET NULL,
  INDEX idx_purchase_supplier (supplier_id), INDEX idx_purchase_status (status), INDEX idx_purchase_date (purchase_date)
);

-- Phase 5: a Draft purchase has no batch yet, so the batch details live on the item until the purchase is confirmed.
CREATE TABLE purchase_items (
  purchase_item_id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_id INT NOT NULL,
  medicine_id INT NOT NULL,
  batch_id INT,                               -- filled in when the purchase is confirmed
  batch_number VARCHAR(50) NULL,
  manufacturing_date DATE NULL,
  expiry_date DATE NULL,
  quantity INT NOT NULL,
  purchase_price DECIMAL(10,2) NOT NULL,
  selling_price DECIMAL(10,2) NULL,
  reorder_level INT NULL,
  subtotal DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (purchase_id) REFERENCES purchases(purchase_id) ON DELETE CASCADE,
  FOREIGN KEY (medicine_id) REFERENCES medicines(medicine_id),
  FOREIGN KEY (batch_id) REFERENCES medicine_batches(batch_id),
  UNIQUE KEY uq_purchase_batch (purchase_id, medicine_id, batch_number)
);

CREATE TABLE notifications (
  notification_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(150) NOT NULL,
  message TEXT NOT NULL,
  type VARCHAR(40) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  INDEX idx_notif_user (user_id, is_read)
);
