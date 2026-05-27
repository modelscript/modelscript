import { SearchIcon } from "@primer/octicons-react";
import { useEffect, useRef, useState } from "react";

type Emoji = { char: string; name: string; hasSkinTone?: boolean };

const EMOJI_CATEGORIES: { title: string; icon: string; emojis: Emoji[] }[] = [
  {
    title: "Smileys & Emotion",
    icon: "😀",
    emojis: [
      { char: "😀", name: "grinning face" },
      { char: "😃", name: "grinning face with big eyes" },
      { char: "😄", name: "grinning face with smiling eyes" },
      { char: "😁", name: "beaming face with smiling eyes" },
      { char: "😆", name: "grinning squinting face" },
      { char: "😅", name: "grinning face with sweat" },
      { char: "🤣", name: "rolling on the floor laughing" },
      { char: "😂", name: "face with tears of joy" },
      { char: "🙂", name: "slightly smiling face" },
      { char: "🙃", name: "upside-down face" },
      { char: "😉", name: "winking face" },
      { char: "😊", name: "smiling face with smiling eyes" },
      { char: "😇", name: "smiling face with halo" },
      { char: "🥰", name: "smiling face with hearts" },
      { char: "😍", name: "smiling face with heart-eyes" },
      { char: "🤩", name: "star-struck" },
      { char: "😘", name: "face blowing a kiss" },
      { char: "😗", name: "kissing face" },
      { char: "☺️", name: "smiling face" },
      { char: "😚", name: "kissing face with closed eyes" },
      { char: "😋", name: "face savoring food" },
      { char: "😛", name: "face with tongue" },
      { char: "😜", name: "winking face with tongue" },
      { char: "🤪", name: "zany face" },
      { char: "😝", name: "squinting face with tongue" },
      { char: "🤑", name: "money-mouth face" },
      { char: "🤗", name: "smiling face with open hands" },
      { char: "🤭", name: "face with hand over mouth" },
      { char: "🤫", name: "shushing face" },
      { char: "🤔", name: "thinking face" },
      { char: "🤐", name: "zipper-mouth face" },
      { char: "🤨", name: "face with raised eyebrow" },
      { char: "😐", name: "neutral face" },
      { char: "😑", name: "expressionless face" },
      { char: "😶", name: "face without mouth" },
      { char: "😏", name: "smirking face" },
      { char: "😒", name: "unamused face" },
      { char: "🙄", name: "face with rolling eyes" },
      { char: "😬", name: "grimacing face" },
      { char: "🤥", name: "lying face" },
      { char: "😌", name: "relieved face" },
      { char: "😔", name: "pensive face" },
      { char: "😪", name: "sleepy face" },
      { char: "🤤", name: "drooling face" },
      { char: "😴", name: "sleeping face" },
      { char: "😷", name: "face with medical mask" },
      { char: "🤒", name: "face with thermometer" },
      { char: "🤕", name: "face with head-bandage" },
      { char: "🤢", name: "nauseated face" },
      { char: "🤮", name: "face vomiting" },
      { char: "🤧", name: "sneezing face" },
      { char: "🥵", name: "hot face" },
      { char: "🥶", name: "cold face" },
      { char: "🥴", name: "woozy face" },
      { char: "😵", name: "face with crossed-out eyes" },
      { char: "🤯", name: "exploding head" },
      { char: "🤠", name: "cowboy hat face" },
      { char: "🥳", name: "partying face" },
      { char: "😎", name: "smiling face with sunglasses" },
      { char: "🤓", name: "nerd face" },
      { char: "🧐", name: "face with monocle" },
      { char: "😕", name: "confused face" },
      { char: "😟", name: "worried face" },
      { char: "🙁", name: "slightly frowning face" },
      { char: "😮", name: "face with open mouth" },
      { char: "😯", name: "hushed face" },
      { char: "😲", name: "astonished face" },
      { char: "😳", name: "flushed face" },
      { char: "🥺", name: "pleading face" },
      { char: "😦", name: "frowning face with open mouth" },
      { char: "😧", name: "anguished face" },
      { char: "😨", name: "fearful face" },
      { char: "😰", name: "anxious face with sweat" },
      { char: "😥", name: "sad but relieved face" },
      { char: "😢", name: "crying face" },
      { char: "😭", name: "loudly crying face" },
      { char: "😱", name: "face screaming in fear" },
      { char: "😖", name: "confounded face" },
      { char: "😣", name: "persevering face" },
      { char: "😞", name: "disappointed face" },
      { char: "😓", name: "downcast face with sweat" },
      { char: "😩", name: "weary face" },
      { char: "😫", name: "tired face" },
      { char: "🥱", name: "yawning face" },
      { char: "😤", name: "face with steam from nose" },
      { char: "😡", name: "pouting face" },
      { char: "😠", name: "angry face" },
      { char: "🤬", name: "face with symbols on mouth" },
    ],
  },
  {
    title: "People & Body",
    icon: "👋",
    emojis: [
      { char: "👋", name: "waving hand", hasSkinTone: true },
      { char: "🤚", name: "raised back of hand", hasSkinTone: true },
      { char: "🖐️", name: "hand with fingers splayed", hasSkinTone: true },
      { char: "✋", name: "raised hand", hasSkinTone: true },
      { char: "🖖", name: "vulcan salute", hasSkinTone: true },
      { char: "👌", name: "OK hand", hasSkinTone: true },
      { char: "✌️", name: "victory hand", hasSkinTone: true },
      { char: "🤞", name: "crossed fingers", hasSkinTone: true },
      { char: "🤟", name: "love-you gesture", hasSkinTone: true },
      { char: "🤘", name: "sign of the horns", hasSkinTone: true },
      { char: "🤙", name: "call me hand", hasSkinTone: true },
      { char: "👈", name: "backhand index pointing left", hasSkinTone: true },
      { char: "👉", name: "backhand index pointing right", hasSkinTone: true },
      { char: "👆", name: "backhand index pointing up", hasSkinTone: true },
      { char: "🖕", name: "middle finger", hasSkinTone: true },
      { char: "👇", name: "backhand index pointing down", hasSkinTone: true },
      { char: "☝️", name: "index pointing up", hasSkinTone: true },
      { char: "👍", name: "thumbs up", hasSkinTone: true },
      { char: "👎", name: "thumbs down", hasSkinTone: true },
      { char: "✊", name: "raised fist", hasSkinTone: true },
      { char: "👊", name: "oncoming fist", hasSkinTone: true },
      { char: "🤛", name: "left-facing fist", hasSkinTone: true },
      { char: "🤜", name: "right-facing fist", hasSkinTone: true },
      { char: "👏", name: "clapping hands", hasSkinTone: true },
      { char: "🙌", name: "raising hands", hasSkinTone: true },
      { char: "👐", name: "open hands", hasSkinTone: true },
      { char: "🤲", name: "palms up together", hasSkinTone: true },
      { char: "🤝", name: "handshake" },
      { char: "🙏", name: "folded hands", hasSkinTone: true },
      { char: "✍️", name: "writing hand", hasSkinTone: true },
      { char: "💅", name: "nail polish", hasSkinTone: true },
      { char: "🤳", name: "selfie", hasSkinTone: true },
      { char: "💪", name: "flexed bicep", hasSkinTone: true },
      { char: "🦵", name: "leg", hasSkinTone: true },
      { char: "🦶", name: "foot", hasSkinTone: true },
      { char: "👂", name: "ear", hasSkinTone: true },
      { char: "🦻", name: "ear with hearing aid", hasSkinTone: true },
      { char: "👃", name: "nose", hasSkinTone: true },
      { char: "🧠", name: "brain" },
      { char: "🦷", name: "tooth" },
      { char: "🦴", name: "bone" },
      { char: "👀", name: "eyes" },
      { char: "👁️", name: "eye" },
      { char: "👅", name: "tongue" },
      { char: "👄", name: "mouth" },
      { char: "🧑", name: "person", hasSkinTone: true },
      { char: "👩", name: "woman", hasSkinTone: true },
      { char: "👨", name: "man", hasSkinTone: true },
    ],
  },
  {
    title: "Animals & Nature",
    icon: "🐶",
    emojis: [
      { char: "🐶", name: "dog face" },
      { char: "🐱", name: "cat face" },
      { char: "🐭", name: "mouse face" },
      { char: "🐹", name: "hamster face" },
      { char: "🐰", name: "rabbit face" },
      { char: "🦊", name: "fox" },
      { char: "🐻", name: "bear" },
      { char: "🐼", name: "panda" },
      { char: "🐵", name: "monkey face" },
      { char: "🙈", name: "see-no-evil monkey" },
      { char: "🙉", name: "hear-no-evil monkey" },
      { char: "🙊", name: "speak-no-evil monkey" },
      { char: "🦁", name: "lion" },
      { char: "🐮", name: "cow face" },
      { char: "🐷", name: "pig face" },
      { char: "🐸", name: "frog" },
      { char: "🐢", name: "turtle" },
      { char: "🐍", name: "snake" },
      { char: "🦎", name: "lizard" },
      { char: "🦖", name: "T-Rex" },
      { char: "🦕", name: "sauropod" },
      { char: "🐙", name: "octopus" },
      { char: "🦑", name: "squid" },
      { char: "🦋", name: "butterfly" },
      { char: "🐛", name: "bug" },
      { char: "🐝", name: "honeybee" },
      { char: "🐞", name: "lady beetle" },
      { char: "🌳", name: "deciduous tree" },
      { char: "🌲", name: "evergreen tree" },
      { char: "🌵", name: "cactus" },
      { char: "🌸", name: "cherry blossom" },
      { char: "🌹", name: "rose" },
      { char: "🌺", name: "hibiscus" },
      { char: "🌻", name: "sunflower" },
      { char: "🌼", name: "blossom" },
      { char: "🌷", name: "tulip" },
      { char: "🌱", name: "seedling" },
      { char: "🪴", name: "potted plant" },
      { char: "✨", name: "sparkles" },
      { char: "🔥", name: "fire" },
      { char: "⭐", name: "star" },
      { char: "🌟", name: "glowing star" },
      { char: "☀️", name: "sun" },
      { char: "🌙", name: "crescent moon" },
      { char: "☁️", name: "cloud" },
      { char: "🌧️", name: "cloud with rain" },
      { char: "❄️", name: "snowflake" },
    ],
  },
  {
    title: "Food & Drink",
    icon: "🍎",
    emojis: [
      { char: "🍏", name: "green apple" },
      { char: "🍎", name: "red apple" },
      { char: "🍐", name: "pear" },
      { char: "🍊", name: "tangerine" },
      { char: "🍋", name: "lemon" },
      { char: "🍌", name: "banana" },
      { char: "🍉", name: "watermelon" },
      { char: "🍇", name: "grapes" },
      { char: "🍓", name: "strawberry" },
      { char: "🫐", name: "blueberries" },
      { char: "🍈", name: "melon" },
      { char: "🍒", name: "cherries" },
      { char: "🍑", name: "peach" },
      { char: "🥭", name: "mango" },
      { char: "🍍", name: "pineapple" },
      { char: "🥥", name: "coconut" },
      { char: "🥝", name: "kiwi fruit" },
      { char: "🍅", name: "tomato" },
      { char: "🍆", name: "eggplant" },
      { char: "🥑", name: "avocado" },
      { char: "🥦", name: "broccoli" },
      { char: "🥬", name: "leafy green" },
      { char: "🥒", name: "cucumber" },
      { char: "🌶️", name: "hot pepper" },
      { char: "🫑", name: "bell pepper" },
      { char: "🌽", name: "ear of corn" },
      { char: "🥕", name: "carrot" },
      { char: "🧄", name: "garlic" },
      { char: "🧅", name: "onion" },
      { char: "🥔", name: "potato" },
      { char: "🥐", name: "croissant" },
      { char: "🥯", name: "bagel" },
      { char: "🍞", name: "bread" },
      { char: "🥖", name: "baguette bread" },
      { char: "🥨", name: "pretzel" },
      { char: "🧀", name: "cheese wedge" },
      { char: "🥚", name: "egg" },
      { char: "🍳", name: "cooking" },
      { char: "🥞", name: "pancakes" },
      { char: "🧇", name: "waffle" },
      { char: "🥓", name: "bacon" },
      { char: "🥩", name: "cut of meat" },
      { char: "🍗", name: "poultry leg" },
      { char: "🍖", name: "meat on bone" },
      { char: "🌭", name: "hot dog" },
      { char: "🍔", name: "hamburger" },
      { char: "🍟", name: "french fries" },
      { char: "🍕", name: "pizza" },
      { char: "🥪", name: "sandwich" },
      { char: "🥙", name: "stuffed flatbread" },
      { char: "🌮", name: "taco" },
      { char: "🌯", name: "burrito" },
      { char: "🥗", name: "green salad" },
      { char: "🥘", name: "shallow pan of food" },
      { char: "🍲", name: "pot of food" },
      { char: "🍿", name: "popcorn" },
      { char: "🍩", name: "doughnut" },
      { char: "🍪", name: "cookie" },
      { char: "🎂", name: "birthday cake" },
      { char: "🍰", name: "shortcake" },
      { char: "🧁", name: "cupcake" },
      { char: "🥧", name: "pie" },
      { char: "🍫", name: "chocolate bar" },
      { char: "🍬", name: "candy" },
      { char: "🍭", name: "lollipop" },
      { char: "☕", name: "hot beverage" },
      { char: "🫖", name: "teapot" },
      { char: "🍵", name: "teacup without handle" },
      { char: "🥤", name: "cup with straw" },
      { char: "🧋", name: "bubble tea" },
      { char: "🧃", name: "beverage box" },
      { char: "🧉", name: "mate" },
      { char: "🧊", name: "ice" },
      { char: "🍺", name: "beer mug" },
      { char: "🍻", name: "clinking beer mugs" },
      { char: "🍷", name: "wine glass" },
      { char: "🥂", name: "clinking glasses" },
      { char: "🥃", name: "tumbler glass" },
      { char: "🍸", name: "cocktail glass" },
      { char: "🍹", name: "tropical drink" },
      { char: "🍾", name: "bottle with popping cork" },
    ],
  },
  {
    title: "Activities",
    icon: "⚽",
    emojis: [
      { char: "⚽", name: "soccer ball" },
      { char: "🏀", name: "basketball" },
      { char: "🏈", name: "american football" },
      { char: "⚾", name: "baseball" },
      { char: "🥎", name: "softball" },
      { char: "🎾", name: "tennis" },
      { char: "🏐", name: "volleyball" },
      { char: "🏉", name: "rugby football" },
      { char: "🥏", name: "flying disc" },
      { char: "🎱", name: "pool 8 ball" },
      { char: "🪀", name: "yo-yo" },
      { char: "🏓", name: "ping pong" },
      { char: "🏸", name: "badminton" },
      { char: "🏒", name: "ice hockey" },
      { char: "🏑", name: "field hockey" },
      { char: "🥍", name: "lacrosse" },
      { char: "🏏", name: "cricket game" },
      { char: "🪃", name: "boomerang" },
      { char: "🥅", name: "goal net" },
      { char: "⛳", name: "flag in hole" },
      { char: "🪁", name: "kite" },
      { char: "🏹", name: "bow and arrow" },
      { char: "🎣", name: "fishing pole" },
      { char: "🤿", name: "diving mask" },
      { char: "🥊", name: "martial arts uniform" },
      { char: "🥋", name: "boxing glove" },
      { char: "🛹", name: "skateboard" },
      { char: "🛼", name: "roller skate" },
      { char: "🛷", name: "sled" },
      { char: "⛸️", name: "ice skate" },
      { char: "🥌", name: "curling stone" },
      { char: "🎿", name: "skis" },
      { char: "⛷️", name: "skier" },
      { char: "🏂", name: "snowboarder" },
      { char: "🏋️", name: "person lifting weights", hasSkinTone: true },
      { char: "🤼", name: "people wrestling" },
      { char: "🤸", name: "person cartwheeling", hasSkinTone: true },
      { char: "⛹️", name: "person bouncing ball", hasSkinTone: true },
      { char: "🤺", name: "person fencing" },
      { char: "🤾", name: "person playing handball", hasSkinTone: true },
      { char: "🏌️", name: "person golfing", hasSkinTone: true },
      { char: "🏇", name: "horse racing", hasSkinTone: true },
      { char: "🧘", name: "person in lotus position", hasSkinTone: true },
      { char: "🏄", name: "person surfing", hasSkinTone: true },
      { char: "🏊", name: "person swimming", hasSkinTone: true },
      { char: "🤽", name: "person playing water polo", hasSkinTone: true },
      { char: "🚣", name: "person rowing boat", hasSkinTone: true },
      { char: "🧗", name: "person climbing", hasSkinTone: true },
      { char: "🚵", name: "person mountain biking", hasSkinTone: true },
      { char: "🚴", name: "person biking", hasSkinTone: true },
      { char: "🏆", name: "trophy" },
      { char: "🥇", name: "1st place medal" },
      { char: "🥈", name: "2nd place medal" },
      { char: "🥉", name: "3rd place medal" },
      { char: "🏅", name: "sports medal" },
      { char: "🎖️", name: "military medal" },
      { char: "🎗️", name: "reminder ribbon" },
      { char: "🎫", name: "ticket" },
      { char: "🎟️", name: "admission tickets" },
      { char: "🎪", name: "circus tent" },
      { char: "🤹", name: "person juggling", hasSkinTone: true },
      { char: "🎭", name: "performing arts" },
      { char: "🩰", name: "ballet shoes" },
      { char: "🎨", name: "artist palette" },
      { char: "🎬", name: "clapper board" },
      { char: "🎤", name: "microphone" },
      { char: "🎧", name: "headphone" },
      { char: "🎼", name: "musical score" },
      { char: "🎹", name: "musical keyboard" },
      { char: "🥁", name: "drum" },
      { char: "🎷", name: "saxophone" },
      { char: "🎺", name: "trumpet" },
      { char: "🎸", name: "guitar" },
      { char: "🪕", name: "banjo" },
      { char: "🎻", name: "violin" },
      { char: "🎲", name: "game die" },
      { char: "♟️", name: "chess pawn" },
      { char: "🎯", name: "direct hit" },
      { char: "🎳", name: "bowling" },
      { char: "🎮", name: "video game" },
      { char: "🎰", name: "slot machine" },
      { char: "🧩", name: "puzzle piece" },
    ],
  },
  {
    title: "Travel & Places",
    icon: "🚗",
    emojis: [
      { char: "🚗", name: "automobile" },
      { char: "🚕", name: "taxi" },
      { char: "🚙", name: "sport utility vehicle" },
      { char: "🚌", name: "bus" },
      { char: "🚎", name: "trolleybus" },
      { char: "🏎️", name: "racing car" },
      { char: "🚓", name: "police car" },
      { char: "🚑", name: "ambulance" },
      { char: "🚒", name: "fire engine" },
      { char: "🚐", name: "minibus" },
      { char: "🛻", name: "pickup truck" },
      { char: "🚚", name: "delivery truck" },
      { char: "🚛", name: "articulated lorry" },
      { char: "🚜", name: "tractor" },
      { char: "🦯", name: "white cane" },
      { char: "🦽", name: "manual wheelchair" },
      { char: "🦼", name: "motorized wheelchair" },
      { char: "🛴", name: "kick scooter" },
      { char: "🚲", name: "bicycle" },
      { char: "🛵", name: "motor scooter" },
      { char: "🏍️", name: "motorcycle" },
      { char: "🛺", name: "auto rickshaw" },
      { char: "🚨", name: "police car light" },
      { char: "🚔", name: "oncoming police car" },
      { char: "🚍", name: "oncoming bus" },
      { char: "🚘", name: "oncoming automobile" },
      { char: "🚖", name: "oncoming taxi" },
      { char: "🚡", name: "aerial tramway" },
      { char: "🚠", name: "mountain cableway" },
      { char: "🚟", name: "suspension railway" },
      { char: "🚃", name: "railway car" },
      { char: "🚋", name: "tram car" },
      { char: "🚞", name: "mountain railway" },
      { char: "🚝", name: "monorail" },
      { char: "🚄", name: "high-speed train" },
      { char: "🚅", name: "bullet train" },
      { char: "🚈", name: "light rail" },
      { char: "🚂", name: "locomotive" },
      { char: "🚆", name: "train" },
      { char: "🚇", name: "metro" },
      { char: "🚊", name: "tram" },
      { char: "🚉", name: "station" },
      { char: "✈️", name: "airplane" },
      { char: "🛫", name: "airplane departure" },
      { char: "🛬", name: "airplane arrival" },
      { char: "🛩️", name: "small airplane" },
      { char: "💺", name: "seat" },
      { char: "🛰️", name: "satellite" },
      { char: "🚀", name: "rocket" },
      { char: "🛸", name: "flying saucer" },
      { char: "🚁", name: "helicopter" },
      { char: "🛶", name: "canoe" },
      { char: "⛵", name: "sailboat" },
      { char: "🚤", name: "speedboat" },
      { char: "🛥️", name: "motor boat" },
      { char: "🛳️", name: "passenger ship" },
      { char: "⛴️", name: "ferry" },
      { char: "🚢", name: "ship" },
      { char: "🌍", name: "globe showing Europe-Africa" },
      { char: "🏠", name: "house" },
      { char: "🏢", name: "office building" },
    ],
  },
  {
    title: "Objects",
    icon: "💡",
    emojis: [
      { char: "💡", name: "light bulb" },
      { char: "📸", name: "camera with flash" },
      { char: "💻", name: "laptop" },
      { char: "📱", name: "mobile phone" },
      { char: "⌚", name: "watch" },
      { char: "📚", name: "books" },
      { char: "💰", name: "money bag" },
      { char: "🎁", name: "wrapped gift" },
      { char: "🎉", name: "party popper" },
      { char: "🎈", name: "balloon" },
    ],
  },
  {
    title: "Symbols",
    icon: "❤️",
    emojis: [
      { char: "❤️", name: "red heart" },
      { char: "🧡", name: "orange heart" },
      { char: "💛", name: "yellow heart" },
      { char: "💚", name: "green heart" },
      { char: "💙", name: "blue heart" },
      { char: "💜", name: "purple heart" },
      { char: "🖤", name: "black heart" },
      { char: "💔", name: "broken heart" },
      { char: "✔️", name: "check mark" },
      { char: "❌", name: "cross mark" },
      { char: "❓", name: "question mark" },
      { char: "❗", name: "exclamation mark" },
    ],
  },
];

const SKIN_TONES = [
  { char: "", color: "#FFDC5E" }, // default yellow
  { char: "🏻", color: "#F7D7C4" },
  { char: "🏼", color: "#D8B094" },
  { char: "🏽", color: "#BB875E" },
  { char: "🏾", color: "#98613C" },
  { char: "🏿", color: "#5A4232" },
];

interface SimpleEmojiPickerProps {
  onEmojiClick: (emojiData: { emoji: string }) => void;
}

export default function SimpleEmojiPicker({ onEmojiClick }: SimpleEmojiPickerProps) {
  const [search, setSearch] = useState("");
  const [hoveredEmoji, setHoveredEmoji] = useState<Emoji | null>(null);
  const [skinTone, setSkinTone] = useState<string>("");
  const [showSkinTones, setShowSkinTones] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>(EMOJI_CATEGORIES[0].title);
  const scrollRef = useRef<HTMLDivElement>(null);
  const categoryRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  useEffect(() => {
    const handleScroll = () => {
      if (!scrollRef.current) return;
      const containerTop = scrollRef.current.getBoundingClientRect().top;

      let currentActive = activeCategory;
      for (const cat of EMOJI_CATEGORIES) {
        const el = categoryRefs.current[cat.title];
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= containerTop + 20) {
            currentActive = cat.title;
          }
        }
      }

      if (currentActive !== activeCategory) {
        setActiveCategory(currentActive);
      }
    };

    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollEl.addEventListener("scroll", handleScroll);
      return () => scrollEl.removeEventListener("scroll", handleScroll);
    }
  }, [activeCategory]);

  const filteredCategories = EMOJI_CATEGORIES.map((category) => {
    const filteredEmojis = category.emojis.filter(
      (emoji) => emoji.name.toLowerCase().includes(search.toLowerCase()) || emoji.char.includes(search),
    );
    return { ...category, emojis: filteredEmojis };
  }).filter((category) => category.emojis.length > 0);

  const getEmojiChar = (emoji: Emoji) => {
    if (!emoji.hasSkinTone || !skinTone) return emoji.char;
    // Remove the variation selector-16 (\uFE0F) before adding skin tone
    return emoji.char.replace(/\uFE0F/g, "") + skinTone;
  };

  const currentSkinColor = SKIN_TONES.find((s) => s.char === skinTone)?.color || SKIN_TONES[0].color;

  return (
    <div
      style={{
        backgroundColor: "var(--color-canvas-overlay, #ffffff)",
        border: "1px solid var(--color-border-default)",
        borderRadius: "8px",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        width: "320px",
        height: "400px",
        overflow: "hidden",
      }}
      onClick={(e) => {
        // Prevent click from bubbling up and closing
        e.stopPropagation();
      }}
    >
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border-subtle)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            backgroundColor: "var(--color-canvas-subtle)",
            borderRadius: "20px",
            padding: "4px 12px",
            border: "1px solid var(--color-border-default)",
          }}
        >
          <SearchIcon size={16} fill="var(--color-fg-muted)" />
          <input
            type="text"
            placeholder="Search emojis"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              border: "none",
              background: "transparent",
              outline: "none",
              padding: "4px 8px",
              width: "100%",
              color: "var(--color-fg-default)",
            }}
          />
        </div>
      </div>

      {!search && (
        <div
          style={{
            display: "flex",
            padding: "8px",
            borderBottom: "1px solid var(--color-border-subtle)",
            justifyContent: "space-between",
          }}
        >
          {EMOJI_CATEGORIES.map((cat) => (
            <button
              key={cat.title}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setActiveCategory(cat.title);
                if (categoryRefs.current[cat.title]) {
                  categoryRefs.current[cat.title]?.scrollIntoView({ behavior: "smooth" });
                }
              }}
              title={cat.title}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontSize: "16px",
                padding: "4px 4px 8px 4px",
                marginBottom: "-9px",
                borderBottom: activeCategory === cat.title ? "2px solid #1d9bf0" : "2px solid transparent",
                color: activeCategory === cat.title ? "var(--color-fg-default)" : "var(--color-fg-muted)",
              }}
              onMouseOver={(e) => {
                if (activeCategory !== cat.title) {
                  e.currentTarget.style.borderBottom = "2px solid var(--color-border-default)";
                }
              }}
              onMouseOut={(e) => {
                if (activeCategory !== cat.title) {
                  e.currentTarget.style.borderBottom = "2px solid transparent";
                }
              }}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "8px 12px",
        }}
      >
        {filteredCategories.length === 0 ? (
          <div style={{ textAlign: "center", padding: "20px", color: "var(--color-fg-muted)" }}>No emojis found</div>
        ) : (
          filteredCategories.map((category) => (
            <div
              key={category.title}
              ref={(el) => {
                categoryRefs.current[category.title] = el;
              }}
              style={{ marginBottom: "16px" }}
            >
              <div
                style={{ fontWeight: "bold", fontSize: "14px", marginBottom: "8px", color: "var(--color-fg-default)" }}
              >
                {category.title}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(8, 1fr)",
                  gap: "4px",
                }}
              >
                {category.emojis.map((emoji) => (
                  <button
                    key={emoji.char}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onEmojiClick({ emoji: getEmojiChar(emoji) });
                    }}
                    onMouseEnter={() => setHoveredEmoji(emoji)}
                    onMouseLeave={() => setHoveredEmoji(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      fontSize: "24px",
                      cursor: "pointer",
                      padding: "4px",
                      borderRadius: "4px",
                      lineHeight: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "var(--color-canvas-subtle)")}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    {getEmojiChar(emoji)}
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <div
        style={{
          borderTop: "1px solid var(--color-border-subtle)",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: "50px",
          backgroundColor: "var(--color-canvas-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "12px", overflow: "hidden", flex: 1 }}>
          {hoveredEmoji && !showSkinTones ? (
            <>
              <span style={{ fontSize: "28px", lineHeight: 1 }}>{getEmojiChar(hoveredEmoji)}</span>
              <span
                style={{
                  fontSize: "14px",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: "var(--color-fg-default)",
                }}
              >
                {hoveredEmoji.name}
              </span>
            </>
          ) : showSkinTones ? (
            <div style={{ display: "flex", gap: "6px", marginLeft: "auto" }}>
              {SKIN_TONES.map((tone) => (
                <button
                  key={tone.char || "default"}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSkinTone(tone.char);
                    setShowSkinTones(false);
                  }}
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "50%",
                    backgroundColor: tone.color,
                    border: skinTone === tone.char ? "2px solid #1d9bf0" : "1px solid var(--color-border-default)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                  title={tone.char ? `Skin tone ${tone.char}` : "Default"}
                />
              ))}
            </div>
          ) : (
            <span style={{ fontSize: "14px", color: "var(--color-fg-muted)" }}>Select an emoji</span>
          )}
        </div>

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowSkinTones(!showSkinTones);
          }}
          style={{
            width: "24px",
            height: "24px",
            borderRadius: "50%",
            backgroundColor: currentSkinColor,
            border: "1px solid var(--color-border-default)",
            cursor: "pointer",
            flexShrink: 0,
            marginLeft: "8px",
          }}
          title="Change skin tone"
        />
      </div>
    </div>
  );
}
