export function renderSearchSuggestionTitle(
  title: string,
  el: HTMLElement,
): void {
  el.addClass("stratum-native-suggestion");
  el.createDiv({
    cls: "stratum-native-suggestion-label",
    text: title,
  });
}
