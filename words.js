'use strict';

// Eigene Wörter einfach in die passende Liste schreiben oder eine neue Kategorie ergänzen.
//
// words: die Begriffe für den normalen Modus.
// pairs: ähnliche Begriffe für den Undercover-Modus (optional). Fehlen sie, bekommt der
//        Undercover einen anderen zufälligen Begriff aus derselben Kategorie. Bei Themen-
//        Kategorien wie Naruto passt das, weil dort alle Begriffe zusammengehören.
module.exports = {
  tiere: {
    label: 'Tiere',
    words: [
      'Giraffe', 'Pinguin', 'Eichhörnchen', 'Krokodil', 'Fledermaus', 'Delfin', 'Igel', 'Kamel',
      'Papagei', 'Schildkröte', 'Elefant', 'Qualle', 'Waschbär', 'Biene', 'Hai', 'Eule',
      'Maulwurf', 'Flamingo', 'Känguru', 'Schnecke', 'Wolf', 'Otter', 'Chamäleon', 'Tintenfisch',
      'Lama', 'Spinne', 'Nashorn', 'Storch', 'Hamster', 'Seepferdchen',
    ],
    pairs: [
      ['Hund', 'Katze'], ['Löwe', 'Tiger'], ['Pferd', 'Esel'], ['Hai', 'Delfin'], ['Eule', 'Rabe'],
      ['Biene', 'Wespe'], ['Frosch', 'Kröte'], ['Krokodil', 'Alligator'], ['Hamster', 'Meerschweinchen'],
      ['Wolf', 'Fuchs'], ['Kamel', 'Lama'], ['Schaf', 'Ziege'],
    ],
  },
  essen: {
    label: 'Essen & Trinken',
    words: [
      'Pizza', 'Döner', 'Spaghetti', 'Sushi', 'Currywurst', 'Pfannkuchen', 'Popcorn', 'Schokolade',
      'Brezel', 'Kartoffelsalat', 'Honig', 'Kaffee', 'Zitrone', 'Wassermelone', 'Knoblauch',
      'Lasagne', 'Burger', 'Gummibärchen', 'Eiscreme', 'Käsefondue', 'Apfelstrudel', 'Taco',
      'Rührei', 'Pommes', 'Limonade', 'Erdnussbutter', 'Waffel', 'Gurke', 'Tomatensuppe', 'Donut',
    ],
    pairs: [
      ['Pizza', 'Flammkuchen'], ['Burger', 'Döner'], ['Kaffee', 'Tee'], ['Pfannkuchen', 'Waffel'],
      ['Zitrone', 'Limette'], ['Spaghetti', 'Lasagne'], ['Eiscreme', 'Frozen Joghurt'], ['Cola', 'Eistee'],
      ['Pommes', 'Kroketten'], ['Croissant', 'Brezel'], ['Sushi', 'Ramen'], ['Muffin', 'Donut'],
    ],
  },
  orte: {
    label: 'Orte',
    words: [
      'Flughafen', 'Krankenhaus', 'Schwimmbad', 'Bibliothek', 'Bahnhof', 'Friedhof', 'Zoo',
      'Supermarkt', 'Leuchtturm', 'Kino', 'Museum', 'Strand', 'Baustelle', 'Tankstelle', 'Schule',
      'Burg', 'Freizeitpark', 'Campingplatz', 'Wüste', 'Gefängnis', 'Rathaus', 'Skihütte',
      'Weihnachtsmarkt', 'U-Bahn', 'Bäckerei', 'Fitnessstudio', 'Kirche', 'Bauernhof', 'Hafen',
      'Raumstation',
    ],
    pairs: [
      ['Kino', 'Theater'], ['Flughafen', 'Bahnhof'], ['Schwimmbad', 'Strand'], ['Schule', 'Universität'],
      ['Krankenhaus', 'Arztpraxis'], ['Supermarkt', 'Kiosk'], ['Burg', 'Schloss'], ['Zoo', 'Aquarium'],
      ['Bibliothek', 'Buchladen'], ['Hotel', 'Hostel'], ['Freizeitpark', 'Jahrmarkt'], ['Kirche', 'Kloster'],
    ],
  },
  berufe: {
    label: 'Berufe',
    words: [
      'Feuerwehrmann', 'Zahnarzt', 'Pilot', 'Koch', 'Polizist', 'Lehrer', 'Friseur', 'Bäcker',
      'Astronaut', 'Tierarzt', 'Busfahrer', 'Richter', 'Gärtner', 'Elektriker', 'Fotograf',
      'Schauspieler', 'Müllmann', 'Bauarbeiter', 'Kellner', 'Detektiv', 'Fischer', 'Tischler',
      'Krankenpfleger', 'Postbote', 'Bibliothekar', 'Zauberer', 'Journalist', 'Programmierer',
      'Schornsteinfeger', 'Hebamme',
    ],
    pairs: [
      ['Arzt', 'Tierarzt'], ['Polizist', 'Detektiv'], ['Koch', 'Bäcker'], ['Pilot', 'Astronaut'],
      ['Lehrer', 'Professor'], ['Sänger', 'Schauspieler'], ['Busfahrer', 'Taxifahrer'], ['Maler', 'Fotograf'],
      ['Kellner', 'Barkeeper'], ['Elektriker', 'Klempner'], ['Richter', 'Anwalt'], ['Zahnarzt', 'Friseur'],
    ],
  },
  gegenstaende: {
    label: 'Gegenstände',
    words: [
      'Regenschirm', 'Zahnbürste', 'Kühlschrank', 'Fernbedienung', 'Schlüssel', 'Rucksack',
      'Staubsauger', 'Kerze', 'Taschenlampe', 'Spiegel', 'Wecker', 'Toaster', 'Kopfhörer',
      'Schere', 'Sonnenbrille', 'Hammer', 'Luftballon', 'Bügeleisen', 'Kissen', 'Mülleimer',
      'Fahrrad', 'Geldbeutel', 'Leiter', 'Würfel', 'Handtuch', 'Gitarre', 'Kompass', 'Thermometer',
      'Lupe', 'Zelt',
    ],
    pairs: [
      ['Kerze', 'Taschenlampe'], ['Löffel', 'Gabel'], ['Kissen', 'Decke'], ['Gitarre', 'Geige'],
      ['Schere', 'Messer'], ['Kühlschrank', 'Gefriertruhe'], ['Fahrrad', 'Roller'], ['Brille', 'Lupe'],
      ['Hammer', 'Schraubenzieher'], ['Wecker', 'Armbanduhr'], ['Tasse', 'Glas'], ['Sofa', 'Sessel'],
    ],
  },
  freizeit: {
    label: 'Sport & Hobbys',
    words: [
      'Fußball', 'Angeln', 'Bowling', 'Schach', 'Klettern', 'Tischtennis', 'Yoga', 'Skifahren',
      'Surfen', 'Boxen', 'Minigolf', 'Karaoke', 'Stricken', 'Tauchen', 'Basketball', 'Reiten',
      'Fallschirmspringen', 'Backen', 'Tanzen', 'Wandern', 'Darts', 'Eishockey', 'Zelten', 'Malen',
      'Skateboarden', 'Volleyball', 'Billard', 'Kochen', 'Bogenschießen', 'Puzzeln',
    ],
    pairs: [
      ['Fußball', 'Handball'], ['Tennis', 'Tischtennis'], ['Skifahren', 'Snowboarden'], ['Surfen', 'Segeln'],
      ['Schach', 'Dame'], ['Boxen', 'Ringen'], ['Basketball', 'Volleyball'], ['Joggen', 'Wandern'],
      ['Darts', 'Bogenschießen'], ['Billard', 'Bowling'], ['Malen', 'Zeichnen'], ['Schwimmen', 'Tauchen'],
    ],
  },
  natur: {
    label: 'Natur & Wetter',
    words: [
      'Vulkan', 'Regenbogen', 'Gewitter', 'Wasserfall', 'Gletscher', 'Tornado', 'Mond', 'Kaktus',
      'Pilz', 'Erdbeben', 'Sonnenblume', 'Nebel', 'Höhle', 'Komet', 'Eiche', 'Lawine', 'Insel',
      'Moos', 'Polarlicht', 'Tsunami', 'Schneeflocke', 'Sandsturm', 'Sonnenfinsternis', 'Korallenriff',
      'Dschungel', 'Hagel', 'Klippe', 'Tulpe', 'Geysir', 'Moor',
    ],
    pairs: [
      ['Regen', 'Hagel'], ['Berg', 'Vulkan'], ['See', 'Meer'], ['Rose', 'Tulpe'], ['Mond', 'Sonne'],
      ['Wald', 'Dschungel'], ['Tornado', 'Hurrikan'], ['Fluss', 'Bach'], ['Wüste', 'Steppe'],
      ['Schnee', 'Eis'], ['Blitz', 'Donner'], ['Insel', 'Halbinsel'],
    ],
  },
  minecraft: {
    label: 'Minecraft',
    words: [
      'Creeper', 'Enderman', 'Steve', 'Herobrine', 'Zombie', 'Skelett', 'Ghast', 'Lohe', 'Enderdrache',
      'Wither', 'Dorfbewohner', 'Eisengolem', 'Diamant', 'Redstone', 'Obsidian', 'Smaragd', 'Spitzhacke',
      'Werkbank', 'Ofen', 'Truhe', 'Bett', 'TNT', 'Fackel', 'Lore', 'Elytra', 'Nether', 'Das Ende',
      'Portal', 'Mine', 'Kolben',
    ],
  },
  pokemon: {
    label: 'Pokémon',
    words: [
      'Pikachu', 'Glurak', 'Bisasam', 'Schiggy', 'Evoli', 'Relaxo', 'Mewtu', 'Mew', 'Gengar', 'Enton',
      'Karpador', 'Garados', 'Pummeluff', 'Mauzi', 'Rattfratz', 'Taubsi', 'Onix', 'Lavados', 'Arktos',
      'Zapdos', 'Lucario', 'Quajutsu', 'Pokéball', 'Pokédex', 'Arena', 'Trainer', 'Orden', 'Team Rocket',
      'Professor Eich', 'Pokémon-Center',
    ],
  },
  isaac: {
    label: 'The Binding of Isaac',
    words: [
      'Isaac', 'Magdalene', 'Cain', 'Judas', 'Azazel', 'Lazarus', 'Eden', 'The Lost', 'Lilith',
      'Keeper', 'Apollyon', 'Bethany', 'Jacob & Esau', 'Monstro', 'Mom', 'Moms Herz', 'Satan',
      'Delirium', 'Hush', 'Mega Satan', 'Brimstone', 'Sacred Heart', 'Godhead', 'Polyphemus',
      'Dr. Fetus', 'Epic Fetus', 'Mutant Spider', 'Soy Milk', 'The D6', 'Krampus',
    ],
  },
  naruto: {
    label: 'Naruto',
    words: [
      'Naruto', 'Sasuke', 'Sakura', 'Kakashi', 'Itachi', 'Madara', 'Obito', 'Jiraiya', 'Tsunade',
      'Orochimaru', 'Gaara', 'Hinata', 'Shikamaru', 'Rock Lee', 'Neji', 'Minato', 'Pain', 'Konan',
      'Kurama', 'Akatsuki', 'Konoha', 'Hokage', 'Rasengan', 'Chidori', 'Sharingan', 'Byakugan',
      'Schattendoppelgänger', 'Chunin-Prüfung', 'Ichiraku Ramen', 'Kunai',
    ],
  },
  onepiece: {
    label: 'One Piece',
    words: [
      'Ruffy', 'Zorro', 'Nami', 'Lysop', 'Sanji', 'Chopper', 'Robin', 'Franky', 'Brook', 'Jinbei',
      'Shanks', 'Ace', 'Whitebeard', 'Blackbeard', 'Buggy', 'Law', 'Boa Hancock', 'Mihawk', 'Kaido',
      'Big Mom', 'Gol D. Roger', 'Thousand Sunny', 'Going Merry', 'Teufelsfrucht', 'Gum-Gum-Frucht',
      'Grand Line', 'Strohhut', 'Marine', 'Kopfgeld', 'Haki',
    ],
  },
  anime: {
    label: 'Anime',
    words: [
      'Attack on Titan', 'Death Note', 'Dragon Ball', 'Demon Slayer', 'Jujutsu Kaisen',
      'My Hero Academia', 'One Punch Man', 'Hunter x Hunter', 'Fullmetal Alchemist', 'Tokyo Ghoul',
      'Sailor Moon', 'Spy x Family', 'Chainsaw Man', 'Bleach', 'Haikyu', 'Black Clover',
      'Mob Psycho', 'Cowboy Bebop', 'Studio Ghibli', 'Totoro', 'Chihiros Reise', 'Goku',
      'Light Yagami', 'Eren', 'Gojo', 'Tanjiro', 'Saitama', 'Levi', 'Kamehameha', 'Vegeta',
    ],
  },
  videospiele: {
    label: 'Videospiele',
    words: [
      'Fortnite', 'Mario', 'Zelda', 'Tetris', 'Pac-Man', 'GTA', 'FIFA', 'Call of Duty', 'Among Us',
      'Sonic', 'Halo', 'Elden Ring', 'Dark Souls', 'The Witcher', 'Skyrim', 'Roblox',
      'League of Legends', 'Valorant', 'Counter-Strike', 'Overwatch', 'Rocket League',
      'Animal Crossing', 'Mario Kart', 'Super Smash Bros', 'Kirby', 'Donkey Kong', 'Fall Guys',
      'Hollow Knight', 'Stardew Valley', 'Hades',
    ],
  },
  filme: {
    label: 'Filme & Serien',
    words: [
      'Star Wars', 'Harry Potter', 'Herr der Ringe', 'Titanic', 'Shrek', 'Avengers', 'Batman',
      'Spider-Man', 'Breaking Bad', 'Stranger Things', 'Squid Game', 'Die Simpsons', 'SpongeBob',
      'Game of Thrones', 'Fluch der Karibik', 'Jurassic Park', 'Toy Story', 'Findet Nemo',
      'Der König der Löwen', 'Die Eiskönigin', 'Minions', 'Matrix', 'Joker', 'Wednesday',
      'The Walking Dead', 'Haus des Geldes', 'Pippi Langstrumpf', 'James Bond', 'Indiana Jones', 'Rocky',
    ],
  },
  fussball: {
    label: 'Fußball',
    words: [
      'Elfmeter', 'Abseits', 'Rote Karte', 'Torwart', 'Eckball', 'Schiedsrichter', 'Champions League',
      'Bundesliga', 'Weltmeisterschaft', 'Messi', 'Ronaldo', 'Neymar', 'Mbappé', 'Haaland',
      'Lewandowski', 'Bayern München', 'Borussia Dortmund', 'Real Madrid', 'FC Barcelona',
      'Manchester United', 'Fallrückzieher', 'Hattrick', 'Freistoß', 'Kopfball', 'Trikot', 'Stadion',
      'Fankurve', 'Pokal', 'Videobeweis', 'Ersatzbank',
    ],
  },
  fashion: {
    label: 'Fashion',
    words: [
      'Sneaker', 'Hoodie', 'Jeans', 'Lederjacke', 'Cap', 'Beanie', 'Schal', 'Handtasche', 'Laufsteg',
      'Model', 'Kleid', 'Krawatte', 'High Heels', 'Stiefel', 'Jogginghose', 'Trenchcoat', 'Bomberjacke',
      'Cargohose', 'Minirock', 'Halskette', 'Ohrringe', 'Piercing', 'Tattoo', 'Gürtel', 'Socken',
      'Vintage', 'Streetwear', 'Bauchtasche', 'Armbanduhr', 'Lippenstift',
    ],
    pairs: [
      ['Sneaker', 'Stiefel'], ['Hoodie', 'Pullover'], ['Jeans', 'Jogginghose'], ['Cap', 'Beanie'],
      ['Kleid', 'Rock'], ['Halskette', 'Armband'], ['Lederjacke', 'Bomberjacke'], ['Krawatte', 'Fliege'],
      ['Handtasche', 'Rucksack'], ['Piercing', 'Tattoo'], ['High Heels', 'Sandalen'], ['Schal', 'Mütze'],
    ],
  },
  marken: {
    label: 'Marken',
    words: [
      'Nike', 'Adidas', 'Puma', 'Apple', 'Samsung', 'Coca-Cola', "McDonald's", 'Burger King', 'IKEA',
      'Lego', 'Netflix', 'YouTube', 'TikTok', 'Instagram', 'Amazon', 'Google', 'Tesla', 'BMW',
      'Mercedes', 'Porsche', 'Ferrari', 'Red Bull', 'Haribo', 'Nutella', 'Gucci', 'Supreme', 'Zara',
      'PlayStation', 'Nintendo', 'Starbucks',
    ],
    pairs: [
      ['Nike', 'Adidas'], ['Apple', 'Samsung'], ['Coca-Cola', 'Pepsi'], ["McDonald's", 'Burger King'],
      ['Netflix', 'Disney+'], ['BMW', 'Mercedes'], ['PlayStation', 'Xbox'], ['Instagram', 'TikTok'],
      ['Ferrari', 'Lamborghini'], ['Red Bull', 'Monster'], ['Gucci', 'Prada'], ['YouTube', 'Twitch'],
    ],
  },
  internet: {
    label: 'Gaming & Internet',
    words: [
      'Controller', 'Speedrun', 'Livestream', 'Meme', 'WLAN', 'Passwort', 'Noob', 'Lagspike',
      'Influencer', 'Emoji', 'Podcast', 'Tastatur', 'Bildschirm', 'Lootbox', 'Cheater', 'Avatar',
      'Bosskampf', 'Mikrofon', 'Abo', 'Spoiler', 'Akku', 'Update', 'Virus', 'Hashtag', 'Grafikkarte',
      'Webcam', 'Rangliste', 'Screenshot', 'Newsletter', 'Roboter',
    ],
    pairs: [
      ['Tastatur', 'Maus'], ['Livestream', 'Podcast'], ['Meme', 'GIF'], ['Controller', 'Joystick'],
      ['Laptop', 'Tablet'], ['WLAN', 'Bluetooth'], ['Kopfhörer', 'Lautsprecher'], ['Virus', 'Hacker'],
      ['Emoji', 'Sticker'], ['Webcam', 'Mikrofon'], ['Update', 'Download'], ['Noob', 'Profi'],
    ],
  },
};
