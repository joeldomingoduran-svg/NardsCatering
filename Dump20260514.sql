





;
;
;
;
;
;
;
;
;
;





DROP TABLE IF EXISTS `bookings`;
;
;
CREATE TABLE `bookings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `clientName` varchar(255) NOT NULL,
  `address` varchar(500) NOT NULL DEFAULT '',
  `eventType` varchar(100) NOT NULL DEFAULT '',
  `package` varchar(50) NOT NULL DEFAULT '',
  `eventDate` date NOT NULL,
  `phone` varchar(20) NOT NULL DEFAULT '',
  `status` enum('pending','confirmed','completed','cancelled') NOT NULL DEFAULT 'pending',
  `notes` text DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `guests` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=54 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
;





LOCK TABLES `bookings` WRITE;
;
INSERT INTO `bookings` VALUES (52,'panget','0215 parola','birthday','Package A','2026-05-01','09584421578','completed','asd','asdqweq@gmail.com',50),(53,'panget','0215 parola','christening','Package A','2026-05-01','09584421578','pending','asdasd','asdqweq@gmail.com',0);
;
UNLOCK TABLES;





DROP TABLE IF EXISTS `cateringassets`;
;
;
CREATE TABLE `cateringassets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 0,
  `unit` varchar(50) NOT NULL DEFAULT 'pcs',
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
;





LOCK TABLES `cateringassets` WRITE;
;
INSERT INTO `cateringassets` VALUES (1,'Table',50,'pcs'),(2,'Chair',100,'pcs'),(3,'Table Cloth',150,'pcs'),(4,'Uniformed Waiter',70,'pcs'),(5,'Grass Carpet',100,'pcs'),(7,'Team Backdrop',50,'pcs'),(8,'Utensil',25,'pcs');
;
UNLOCK TABLES;





DROP TABLE IF EXISTS `clients`;
;
;
CREATE TABLE `clients` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `contact` varchar(20) NOT NULL,
  `email` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
;





LOCK TABLES `clients` WRITE;
;
;
UNLOCK TABLES;





DROP TABLE IF EXISTS `dishes`;
;
;
CREATE TABLE `dishes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `category` varchar(100) NOT NULL DEFAULT 'Main Course',
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
;





LOCK TABLES `dishes` WRITE;
;
INSERT INTO `dishes` VALUES (2,'Lechon','Main Course'),(3,'Pesto pasta','Pasta'),(4,'Menudo','Main Course');
;
UNLOCK TABLES;





DROP TABLE IF EXISTS `inventory`;
;
;
CREATE TABLE `inventory` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `quantity` int(11) NOT NULL DEFAULT 0,
  `threshold` int(11) NOT NULL DEFAULT 0,
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
;





LOCK TABLES `inventory` WRITE;
;
;
UNLOCK TABLES;





DROP TABLE IF EXISTS `menu`;
;
;
CREATE TABLE `menu` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
;





LOCK TABLES `menu` WRITE;
;
;
UNLOCK TABLES;





DROP TABLE IF EXISTS `packageassets`;
;
;
CREATE TABLE `packageassets` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `package_id` int(11) NOT NULL,
  `asset_id` int(11) NOT NULL,
  `qty_required` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `package_id` (`package_id`),
  KEY `asset_id` (`asset_id`),
  CONSTRAINT `packageassets_ibfk_1` FOREIGN KEY (`package_id`) REFERENCES `packages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `packageassets_ibfk_2` FOREIGN KEY (`asset_id`) REFERENCES `cateringassets` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=40 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
;





LOCK TABLES `packageassets` WRITE;
;
INSERT INTO `packageassets` VALUES (26,1,1,5),(27,1,2,5),(28,1,3,5),(30,1,7,1),(31,1,4,1),(32,1,5,1),(33,2,5,1),(34,2,1,1),(35,2,7,1),(38,3,2,1),(39,3,1,1);
;
UNLOCK TABLES;





DROP TABLE IF EXISTS `packagedishes`;
;
;
CREATE TABLE `packagedishes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `package_id` int(11) NOT NULL,
  `dish_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `package_id` (`package_id`),
  KEY `dish_id` (`dish_id`),
  CONSTRAINT `packagedishes_ibfk_1` FOREIGN KEY (`package_id`) REFERENCES `packages` (`id`) ON DELETE CASCADE,
  CONSTRAINT `packagedishes_ibfk_2` FOREIGN KEY (`dish_id`) REFERENCES `dishes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=10 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
;





LOCK TABLES `packagedishes` WRITE;
;
INSERT INTO `packagedishes` VALUES (1,1,2),(2,1,3),(3,2,2),(5,2,3),(8,3,2),(9,3,3);
;
UNLOCK TABLES;





DROP TABLE IF EXISTS `packagefreebies`;
;
;
CREATE TABLE `packagefreebies` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `package_id` int(11) NOT NULL,
  `name` varchar(255) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `package_id` (`package_id`),
  CONSTRAINT `packagefreebies_ibfk_1` FOREIGN KEY (`package_id`) REFERENCES `packages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
;





LOCK TABLES `packagefreebies` WRITE;
;
INSERT INTO `packagefreebies` VALUES (2,1,'1 Free Layer Cake'),(3,2,'1 Free Layer Cake'),(4,2,'1 Free Graizing table');
;
UNLOCK TABLES;





DROP TABLE IF EXISTS `packages`;
;
;
CREATE TABLE `packages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `min_guests` int(11) NOT NULL DEFAULT 0,
  `is_archived` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
;





LOCK TABLES `packages` WRITE;
;
INSERT INTO `packages` VALUES (1,'Package A',30000.00,50),(2,'Package B',35000.00,100),(3,'Package C',50000.00,120);
;
UNLOCK TABLES;
;

;
;
;
;
;
;
;


