/**
 * Trello webhook action filtering (list moves vs in-list position changes).
 */

const POSITION_ONLY_TRANSLATION_KEYS = new Set([
  'action_moved_card_higher',
  'action_moved_card_lower',
  'action_moved_card_to_top_of_list',
  'action_moved_card_to_bottom_of_list',
]);

const POSITION_ONLY_TRANSLATION_PREFIXES = [
  'action_moved_card_higher',
  'action_moved_card_lower',
];

export function getTrelloActionTranslationKey(payload) {
  const action = payload?.action;
  return (
    action?.display?.translationKey ||
    action?.translationKey ||
    action?.type ||
    ''
  );
}

/**
 * True when the webhook is only a vertical reorder within the same list (not a list change).
 */
export function isTrelloPositionOnlyAction(payload) {
  const action = payload?.action;
  if (!action) return false;

  const translationKey = getTrelloActionTranslationKey(payload);

  if (POSITION_ONLY_TRANSLATION_KEYS.has(translationKey)) {
    return true;
  }

  for (const prefix of POSITION_ONLY_TRANSLATION_PREFIXES) {
    if (translationKey.startsWith(prefix)) {
      return true;
    }
  }

  const listBeforeId = action.data?.listBefore?.id;
  const listAfterId = action.data?.listAfter?.id;

  if (listBeforeId && listAfterId && listBeforeId === listAfterId) {
    return true;
  }

  return false;
}

export function extractTrelloCardIdFromPayload(payload) {
  return payload?.action?.data?.card?.id ?? null;
}
