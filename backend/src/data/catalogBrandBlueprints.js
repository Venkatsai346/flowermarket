/**
 * Curated brand coverage by governed leaf category.
 *
 * This is an extensible market-entry registry, not proof of trademark ownership,
 * distributorship, product authenticity or regulatory approval. Seeded brands
 * deliberately remain unverified until the platform governance workflow verifies
 * them. A brand may appear in several categories and is merged into one document.
 */
export const CATEGORY_BRAND_ASSIGNMENTS = Object.freeze({
  'fresh-flowers': ['Ferns N Petals', 'Interflora India', 'FlowerAura', 'IGP', 'Winni'],
  bouquets: ['Ferns N Petals', 'Interflora India', 'FlowerAura', 'IGP', 'Winni', 'OyeGifts'],
  'live-plants': ['Green Thumb', 'Ugaoo', 'NurseryLive', 'FlowerAura', 'TrustBasket', 'Kyari', 'Root Bridges'],
  'seeds-bulbs': ['Kraft Seeds', 'TrustBasket', 'Ugaoo', 'NurseryLive', 'AllThatGrows', 'Namdhari Seeds', 'VNR Seeds', 'Mahyco'],

  smartphones: ['Apple', 'Samsung', 'Google', 'OnePlus', 'Xiaomi', 'Redmi', 'POCO', 'realme', 'vivo', 'OPPO', 'iQOO', 'Motorola', 'Nothing', 'Nokia', 'Lava', 'Micromax', 'Infinix', 'TECNO', 'HONOR', 'ASUS'],
  tablets: ['Apple', 'Samsung', 'Lenovo', 'Xiaomi', 'Redmi', 'OnePlus', 'realme', 'HONOR', 'Motorola', 'Nokia', 'Amazon', 'Microsoft', 'ASUS', 'Acer'],
  laptops: ['HP', 'Dell', 'Lenovo', 'Apple', 'ASUS', 'Acer', 'Microsoft', 'MSI', 'Samsung', 'LG', 'Infinix', 'HONOR', 'Gigabyte', 'Avita'],
  'televisions-monitors': ['Samsung', 'LG', 'Sony', 'TCL', 'Hisense', 'Xiaomi', 'OnePlus', 'Panasonic', 'Vu', 'Thomson', 'Kodak', 'Blaupunkt', 'Acer', 'BenQ', 'Dell', 'HP', 'Lenovo', 'ViewSonic', 'AOC'],
  'audio-wearables': ['Apple', 'Samsung', 'Sony', 'JBL', 'Bose', 'Sennheiser', 'Marshall', 'boAt', 'Noise', 'Boult', 'Mivi', 'pTron', 'OnePlus', 'realme', 'Xiaomi', 'OPPO', 'Garmin', 'Fitbit', 'Amazfit', 'Fastrack'],
  cameras: ['Canon', 'Nikon', 'Sony', 'Fujifilm', 'Panasonic', 'GoPro', 'DJI', 'Insta360', 'Leica', 'OM System', 'Sigma', 'Tamron', 'Godox'],

  'major-appliances': ['LG', 'Samsung', 'Whirlpool', 'Haier', 'Godrej Appliances', 'Bosch', 'Siemens', 'IFB', 'Voltas', 'Blue Star', 'Daikin', 'Panasonic', 'Philips', 'Bajaj', 'Havells', 'Crompton', 'Prestige', 'Usha', 'Kent', 'AO Smith', 'Eureka Forbes', 'Morphy Richards'],
  furniture: ['IKEA', 'Godrej Interio', 'Nilkamal', 'Wakefit', 'Pepperfry', 'Urban Ladder', 'Durian', 'Home Centre', 'WoodenStreet', 'Spacewood', 'Sleepwell', 'Duroflex', 'Kurlon'],

  apparel: ["Levi's", 'Nike', 'Adidas', 'Puma', 'Allen Solly', 'Van Heusen', 'Peter England', 'Louis Philippe', 'H&M', 'Zara', 'Uniqlo', 'Biba', 'W for Woman', 'Fabindia', 'Manyavar', 'Jockey', 'Raymond', 'Monte Carlo', 'U.S. Polo Assn.', 'Jack & Jones', 'ONLY', 'Vero Moda', 'Marks & Spencer', 'Max Fashion', 'Pantaloons'],
  footwear: ['Bata', 'Liberty', 'Relaxo', 'Campus', 'Woodland', 'Skechers', 'Crocs', 'Red Tape', 'Metro', 'Mochi', 'Nike', 'Adidas', 'Puma', 'Reebok', 'ASICS', 'New Balance', 'Clarks', 'Hush Puppies', 'Paragon', 'Khadim'],
  jewellery: ['Tanishq', 'Kalyan Jewellers', 'Malabar Gold & Diamonds', 'Joyalukkas', 'Senco Gold & Diamonds', 'CaratLane', 'BlueStone', 'PC Jeweller', 'Mia by Tanishq', 'Reliance Jewels', 'Candere', 'GIVA', 'Voylla', 'Tribe Amrapali'],

  'beauty-cosmetics': ["L'Oréal Paris", 'Maybelline New York', 'Lakmé', 'M.A.C Cosmetics', 'Nykaa Cosmetics', 'Mamaearth', 'Plum', 'Minimalist', 'The Derma Co', 'Biotique', 'Himalaya', 'NIVEA', 'Dove', 'Cetaphil', 'Neutrogena', 'Forest Essentials', 'Kama Ayurveda', 'Colorbar', 'SUGAR Cosmetics', 'Lotus Herbals', 'WOW Skin Science', 'Revlon'],
  supplements: ['MuscleBlaze', 'Optimum Nutrition', 'GNC', 'HK Vitals', 'Himalaya', 'Carbamide Forte', 'Fast&Up', 'Wellbeing Nutrition', 'HealthKart', 'Kapiva', 'TrueBasics', 'Myprotein', 'Isopure', 'MuscleTech', 'Ensure', 'Protinex'],
  'medical-devices': ['Omron', 'Dr Trust', 'Accu-Chek', 'Beurer', 'Philips', 'BPL Medical Technologies', 'HealthSense', 'Dr Morepen', 'OneTouch', 'Contour', 'Romsons', 'Hicks', 'Rossmax', 'Medtech Life'],

  'packaged-food': ['Tata Sampann', 'Aashirvaad', 'Fortune', 'Amul', 'Nestlé', 'Britannia', 'Parle', "Haldiram's", 'MTR', 'MDH', 'Catch', 'Dabur', 'Patanjali', 'Paper Boat', 'Coca-Cola', 'Pepsi', 'Cadbury', 'Ferrero Rocher', 'Kellogg’s', 'Quaker', 'Saffola', 'Maggi', 'Sunfeast', 'Bingo!', 'Too Yumm!', 'Mother Dairy', 'Epigamia'],
  'fresh-produce': ['Safal', 'Organic Tattva', '24 Mantra Organic', 'Natureland Organics', 'Conscious Food', 'Down to Earth', 'Healthy Buddha', 'Akshayakalpa Organic'],

  books: ['Penguin Random House India', 'HarperCollins India', 'Hachette India', 'Simon & Schuster India', 'Pan Macmillan India', 'Bloomsbury India', 'Rupa Publications', 'S. Chand', 'Arihant Publications', 'Oswaal Books', 'MTG Learning Media', 'Scholastic India', 'Oxford University Press', 'Cambridge University Press', 'Westland Books', 'Juggernaut Books'],
  toys: ['LEGO', 'Mattel', 'Hasbro', 'Funskool', 'Hamleys', 'Fisher-Price', 'Nerf', 'Hot Wheels', 'Play-Doh', 'Skillmatics', 'Shumee', 'Make It Real', 'Frank', 'Centy Toys', 'Smartivity', 'Imagimake', 'Webby'],

  'automotive-parts': ['Bosch', 'Uno Minda', 'Minda', 'ZF Aftermarket', 'Valeo', 'Hella', 'Philips', 'MRF', 'CEAT', 'Apollo Tyres', 'JK Tyre', 'Castrol', 'Shell', 'Motul', 'Mobil', 'NGK', 'Denso', 'Brembo', 'Roots', 'Lumax'],
  batteries: ['Exide', 'Amaron', 'Luminous', 'Livguard', 'Duracell', 'Energizer', 'Panasonic', 'Eveready', 'Anker', 'Xiaomi', 'Samsung', 'V-Guard', 'Okaya', 'SF Batteries', 'Tata Green Batteries'],

  'digital-products': ['Microsoft', 'Adobe', 'Autodesk', 'Corel', 'Kaspersky', 'Norton', 'Quick Heal', 'Zoho', 'JetBrains', 'Canva', 'Tally Solutions', 'Busy', 'ESET', 'McAfee'],
  services: ['Urban Company', 'Housejoy', 'NoBroker', 'Sulekha', 'Justdial', 'Livspace', 'HomeLane', 'Wakefit', 'Ferns N Petals'],
  'gift-hampers': ['Ferns N Petals', 'IGP', 'FlowerAura', 'Winni', 'Archies', 'Chumbak', 'Cadbury', 'Ferrero Rocher', "Haldiram's", 'The Gift Studio', 'OyeGifts'],
});
