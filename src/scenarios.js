// Each scenario is a real family moment where heritage speakers tend to freeze.
// Replace or reorder these based on what your user interviews tell you.
// `opener` is shown without calling the model, so a scenario always starts instantly.

export const LANGUAGE = {
  code: "vi-VN",
  name: "Vietnamese",
  dialect: "Southern Vietnamese (Saigon)",
};

export const SCENARIOS = [
  {
    id: "call-grandma",
    badge: "Bà",
    title: "Call Bà Ngoại",
    who: "Bà Ngoại, your grandmother",
    situation: "It's Sunday evening and you're calling your grandma to catch up.",
    goal: "Tell her two things about your week and ask how her health is.",
    character:
      "You are Bà Ngoại, a warm, slightly hard-of-hearing Vietnamese grandmother in her late 70s. You call the user 'con'. You worry whether they are eating enough and ask about school.",
    opener: {
      vi: "Alô, con hả? Bà nhớ con quá! Tuần này con sao rồi?",
      en: "Hello, is that you? Grandma misses you so much! How was your week?",
    },
  },
  {
    id: "order-pho",
    badge: "Chị",
    title: "Order for the family",
    who: "Chị Lan, a server at a family phở restaurant",
    situation: "You're at a busy phở restaurant and everyone expects you to order for the table.",
    goal: "Order food for three people, including one person who doesn't eat beef.",
    character:
      "You are Chị Lan, a friendly but busy server at a Vietnamese phở restaurant. You speak quickly and casually, ask about sizes (nhỏ, lớn) and drinks.",
    opener: {
      vi: "Chào em! Mấy người vậy em? Ăn gì nè?",
      en: "Hi! How many of you? What would you like?",
    },
  },
  {
    id: "explain-major",
    badge: "Cô",
    title: "Explain your major to Cô Hạnh",
    who: "Cô Hạnh, your mom's close friend",
    situation: "At a family party, an auntie asks what you study and what job you'll get.",
    goal: "Explain what you study and what you want to do after graduating.",
    character:
      "You are Cô Hạnh, a curious, talkative family friend in her 50s. You don't know much about technology and ask simple follow-up questions like 'là làm gì?' (what does that mean?).",
    opener: {
      vi: "Ủa, con học năm mấy rồi? Con học ngành gì vậy con?",
      en: "Oh, what year are you in now? What are you studying?",
    },
  },
  {
    id: "ask-parents",
    badge: "Mẹ",
    title: "Ask your parents for advice",
    who: "Mẹ, your mom",
    situation: "You're home for dinner and want your mom's advice about a stressful decision.",
    goal: "Describe a problem you're dealing with and ask what she thinks you should do.",
    character:
      "You are Mẹ, the user's mother. You are caring but direct, and you give practical advice. You sometimes tease gently.",
    opener: {
      vi: "Con ăn thêm đi. Sao nhìn con mệt vậy? Có chuyện gì không?",
      en: "Eat some more. Why do you look so tired? Is something wrong?",
    },
  },
  {
    id: "tet-wishes",
    badge: "Ông",
    title: "Tết wishes for the elders",
    who: "Ông Nội, your grandfather",
    situation: "It's Lunar New Year and it's your turn to give wishes to Grandpa.",
    goal: "Give Grandpa a New Year's wish and thank him politely for the lì xì.",
    character:
      "You are Ông Nội, a proud, formal grandfather. You appreciate polite language and traditional New Year wishes, and you hand out lì xì (lucky money).",
    opener: {
      vi: "Năm mới rồi. Con chúc ông gì nào?",
      en: "It's the New Year. What wish do you have for Grandpa?",
    },
  },
];

export const LEVELS = {
  freeze: "Understands most everyday Vietnamese but freezes when speaking. Keep replies short and simple.",
  simple: "Can say simple sentences with mistakes. Use everyday words and short sentences.",
  comfortable: "Speaks fairly comfortably. Use natural, conversational speed and vocabulary.",
};

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) || null;
}
