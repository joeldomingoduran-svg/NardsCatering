



CREATE DATABASE IF NOT EXISTS capstone_db;
USE capstone_db;





CREATE TABLE IF NOT EXISTS Clients (
  id      INT            NOT NULL AUTO_INCREMENT,
  name    VARCHAR(255)   NOT NULL,
  contact VARCHAR(20)    NOT NULL DEFAULT '+63 000 000 0000',
  email   VARCHAR(255)   NOT NULL,
  password VARCHAR(255)  NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  UNIQUE KEY uq_clients_email (email)
);

CREATE TABLE IF NOT EXISTS StaffUsers (
  id         INT NOT NULL AUTO_INCREMENT,
  name       VARCHAR(255) NOT NULL,
  username   VARCHAR(100) NOT NULL,
  password   VARCHAR(255) NOT NULL,
  role       ENUM('admin', 'staff') NOT NULL DEFAULT 'staff',
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_users_username (username)
);

CREATE TABLE IF NOT EXISTS LoginHistory (
  id           INT NOT NULL AUTO_INCREMENT,
  user_id      INT NOT NULL,
  username     VARCHAR(100) NOT NULL,
  role         ENUM('admin', 'staff') NOT NULL,
  logged_in_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_login_history_user (user_id),
  FOREIGN KEY (user_id) REFERENCES StaffUsers(id) ON DELETE CASCADE
);





CREATE TABLE IF NOT EXISTS Bookings (
  id          INT          NOT NULL AUTO_INCREMENT,
  clientName  VARCHAR(255) NOT NULL,
  address     VARCHAR(500) NOT NULL,
  eventType   VARCHAR(100) NOT NULL,
  package     VARCHAR(50)  NOT NULL,
  eventDate   DATE         NOT NULL,
  phone       VARCHAR(20)  NOT NULL,
  status      ENUM('pending', 'confirmed', 'completed', 'cancelled') NOT NULL DEFAULT 'pending',
  cancellationReason VARCHAR(500) DEFAULT NULL,
  notes       TEXT,
  PRIMARY KEY (id)
);








CREATE TABLE IF NOT EXISTS Inventory (
  id        INT          NOT NULL AUTO_INCREMENT,
  name      VARCHAR(255) NOT NULL,
  quantity  INT          NOT NULL DEFAULT 0,
  threshold INT          NOT NULL DEFAULT 0,
  is_archived TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
);





CREATE TABLE IF NOT EXISTS Menu (
  id          INT            NOT NULL AUTO_INCREMENT,
  name        VARCHAR(255)   NOT NULL,
  description TEXT,
  price       DECIMAL(10, 2) NOT NULL,
  PRIMARY KEY (id)
);





CREATE TABLE IF NOT EXISTS Packages (
  id         INT            NOT NULL AUTO_INCREMENT,
  name       VARCHAR(255)   NOT NULL,
  price      DECIMAL(10, 2) NOT NULL,
  min_guests INT            NOT NULL DEFAULT 0,
  is_archived TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
);





CREATE TABLE IF NOT EXISTS CateringAssets (
  id       INT          NOT NULL AUTO_INCREMENT,
  name     VARCHAR(255) NOT NULL,
  quantity INT          NOT NULL DEFAULT 0,
  unit     VARCHAR(50)  NOT NULL DEFAULT 'pcs',
  is_archived TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
);




CREATE TABLE IF NOT EXISTS PackageAssets (
  id           INT NOT NULL AUTO_INCREMENT,
  package_id   INT NOT NULL,
  asset_id     INT NOT NULL,
  qty_required INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  FOREIGN KEY (package_id) REFERENCES Packages(id)      ON DELETE CASCADE,
  FOREIGN KEY (asset_id)   REFERENCES CateringAssets(id) ON DELETE CASCADE
);





ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS notes   TEXT;
ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS email   VARCHAR(255);
ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS guests  INT NOT NULL DEFAULT 0;
ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS stripePaymentIntentId VARCHAR(255) DEFAULT NULL;
ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS paymentStatus ENUM('unpaid','paid','failed') NOT NULL DEFAULT 'unpaid';
ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS downPaymentAmount DECIMAL(10,2) DEFAULT NULL;
ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS termsAcceptedAt DATETIME DEFAULT NULL;
ALTER TABLE Bookings ADD COLUMN IF NOT EXISTS termsVersion VARCHAR(20) DEFAULT NULL;




CREATE TABLE IF NOT EXISTS Dishes (
  id       INT          NOT NULL AUTO_INCREMENT,
  name     VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL DEFAULT 'Main Course',
  is_archived TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
);




CREATE TABLE IF NOT EXISTS PackageDishes (
  id         INT NOT NULL AUTO_INCREMENT,
  package_id INT NOT NULL,
  dish_id    INT NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (package_id) REFERENCES Packages(id) ON DELETE CASCADE,
  FOREIGN KEY (dish_id)    REFERENCES Dishes(id)   ON DELETE CASCADE
);




CREATE TABLE IF NOT EXISTS PackageFreebies (
  id         INT          NOT NULL AUTO_INCREMENT,
  package_id INT          NOT NULL,
  name       VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY (package_id) REFERENCES Packages(id) ON DELETE CASCADE
);




CREATE TABLE IF NOT EXISTS DishIngredients (
  id           INT NOT NULL AUTO_INCREMENT,
  dish_id       INT NOT NULL,
  inventory_id  INT NOT NULL,
  qty_required  INT NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dish_inventory (dish_id, inventory_id),
  FOREIGN KEY (dish_id)      REFERENCES Dishes(id)    ON DELETE CASCADE,
  FOREIGN KEY (inventory_id) REFERENCES Inventory(id) ON DELETE CASCADE
);
