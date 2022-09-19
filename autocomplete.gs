/**
 * @OnlyCurrentDoc
 *
 * The above comment directs Apps Script to limit the scope of file
 * access for this add-on. It specifies that this add-on will only
 * attempt to read or modify the files in which the add-on is used,
 * and not all of the user's files. The authorization request message
 * presented to users will reflect this limited scope.
 */

/**
 * Creates a menu entry in the Google Docs UI when the document is opened.
 * This method is only used by the regular add-on, and is never called by
 * the mobile add-on version.
 *
 * @param {object} e The event parameter for a simple onOpen trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode.
 */
var defaultApiKey = "YOUR-API-KEY";

function onOpen(e) {
    DocumentApp.getUi().createAddonMenu()
        .addItem('Start', 'showSidebar')
        .addToUi();
}

/**
 * Runs when the add-on is installed.
 * This method is only used by the regular add-on, and is never called by
 * the mobile add-on version.
 *
 * @param {object} e The event parameter for a simple onInstall trigger. To
 *     determine which authorization mode (ScriptApp.AuthMode) the trigger is
 *     running in, inspect e.authMode. (In practice, onInstall triggers always
 *     run in AuthMode.FULL, but onOpen triggers may be AuthMode.LIMITED or
 *     AuthMode.NONE.)
 */
function onInstall(e) {
    onOpen(e);
}

/**
 * Opens a sidebar in the document containing the add-on's user interface.
 * This method is only used by the regular add-on, and is never called by
 * the mobile add-on version.
 */
function showSidebar() {
    const ui = HtmlService.createHtmlOutputFromFile('sidebar')
        .setTitle('GPT3 Autocomplete');
    DocumentApp.getUi().showSidebar(ui);
}

/**
 * Gets the text the user has selected. If there is no selection,
 * this function displays an error message.
 *
 * @return {Array.<string>} The selected text.
 */
function getSelectedText() {
    const selection = DocumentApp.getActiveDocument().getSelection();
    const text = [];
    if (selection) {
        const elements = selection.getSelectedElements();
        for (let i = 0; i < elements.length; ++i) {
            if (elements[i].isPartial()) {
                const element = elements[i].getElement().asText();
                const startIndex = elements[i].getStartOffset();
                const endIndex = elements[i].getEndOffsetInclusive();

                text.push(element.getText().substring(startIndex, endIndex + 1));
            } else {
                const element = elements[i].getElement();
                // Only translate elements that can be edited as text; skip images and
                // other non-text elements.
                if (element.editAsText) {
                    const elementText = element.asText().getText();
                    // This check is necessary to exclude images, which return a blank
                    // text element.
                    if (elementText) {
                        text.push(elementText);
                    }
                }
            }
        }
    }
    if (!text.length) throw new Error('Please select some text.');
    return text;
}

/**
 * Gets the stored user preferences for the origin and destination languages,
 * if they exist.
 * This method is only used by the regular add-on, and is never called by
 * the mobile add-on version.
 *
 * @return {Object} The user's origin and destination language preferences, if
 *     they exist.
 */
function getPreferences() {
    const userProperties = PropertiesService.getUserProperties();
    return {
        originLang: userProperties.getProperty('originLang'),
        destLang: userProperties.getProperty('destLang')
    };
}

/**
 * Gets the user-selected text and translates it from the origin language to the
 * destination language. The languages are notated by their two-letter short
 * form. For example, English is 'en', and Spanish is 'es'. The origin language
 * may be specified as an empty string to indicate that Google Translate should
 * auto-detect the language.
 *
 * @param {string} origin The two-letter short form for the origin language.
 * @param {string} dest The two-letter short form for the destination language.
 * @param {boolean} savePrefs Whether to save the origin and destination
 *     language preferences.
 * @return {Object} Object containing the original text and the result of the
 *     translation.
 */
function getTextAndTranslation(apiKeyIn, modelIn, maxTokensIn, temperatureIn, topPIn, presencePenaltyIn, frequencyPenaltyIn, origin, dest, savePrefs) {
    if (savePrefs) {
        PropertiesService.getUserProperties()
            .setProperty('originLang', origin)
            .setProperty('destLang', dest);
    }
    const text = getSelectedText().join('\n');

    // Set defaults if value not passed in | TODO: ensure values are withtin proper bounds here
    const apiKey = apiKeyIn != "" ? apiKeyIn : defaultApiKey;
    const model = modelIn != "" ? modelIn : "text-davinci-002";
    const maxTokens = maxTokensIn != "" ? parseInt(maxTokensIn) : 100;
    const temperature = temperatureIn != "" ? parseFloat(temperatureIn) : 0.9;
    const topP = topPIn != "" ? topPIn: 1;
    const presencePenalty = presencePenaltyIn != "" ? parseFloat(presencePenaltyIn) : 0;
    const frequencyPenalty = frequencyPenaltyIn != "" ? parseFloat(frequencyPenaltyIn) : 0;

    return {
        text: text,
        translation: completedText(apiKey, model, maxTokens, temperature, topP, presencePenalty, frequencyPenalty, text)
    };
}

function completedText(apiKey, model, maxTokens, temperature, topP, presencePenalty, frequencyPenalty, text) {

    var data = {
        "model": model,
        "prompt": "Complete the following text: " + text,
        "temperature": temperature,
        "max_tokens": maxTokens,
        "top_p": topP,
        "presence_penalty": presencePenalty,
        "frequency_penalty": frequencyPenalty
    };
    var options = {
        'method': 'post',
        'contentType': 'application/json',
        'payload': JSON.stringify(data),
        'headers': {
            Authorization: 'Bearer ' + apiKey,
        },
    };

    var response = UrlFetchApp.fetch(
        'https://api.openai.com/v1/completions',
        options,
    );

    out = JSON.parse(response.getContentText())['choices'][0]['text'].trim();
    Logger.log(out);
    return out;
}

/**
 * Replaces the text of the current selection with the provided text, or
 * inserts text at the current cursor location. (There will always be either
 * a selection or a cursor.) If multiple elements are selected, only inserts the
 * translated text in the first element that can contain text and removes the
 * other elements.
 *
 * @param {string} newText The text with which to replace the current selection.
 */
function insertText(newText) {
    const selection = DocumentApp.getActiveDocument().getSelection();
    if (selection) {
        let replaced = false;
        const elements = selection.getSelectedElements();
        if (elements.length === 1 && elements[0].getElement().getType() ===
            DocumentApp.ElementType.INLINE_IMAGE) {
            throw new Error('Can\'t insert text into an image.');
        }
        for (let i = 0; i < elements.length; ++i) {
            if (elements[i].isPartial()) {
                const element = elements[i].getElement().asText();
                const startIndex = elements[i].getStartOffset();
                const endIndex = elements[i].getEndOffsetInclusive();
                element.deleteText(startIndex, endIndex);
                if (!replaced) {
                    element.insertText(startIndex, newText);
                    replaced = true;
                } else {
                    // This block handles a selection that ends with a partial element. We
                    // want to copy this partial text to the previous element so we don't
                    // have a line-break before the last partial.
                    const parent = element.getParent();
                    const remainingText = element.getText().substring(endIndex + 1);
                    parent.getPreviousSibling().asText().appendText(remainingText);
                    // We cannot remove the last paragraph of a doc. If this is the case,
                    // just remove the text within the last paragraph instead.
                    if (parent.getNextSibling()) {
                        parent.removeFromParent();
                    } else {
                        element.removeFromParent();
                    }
                }
            } else {
                const element = elements[i].getElement();
                if (!replaced && element.editAsText) {
                    // Only translate elements that can be edited as text, removing other
                    // elements.
                    element.clear();
                    element.asText().setText(newText);
                    replaced = true;
                } else {
                    // We cannot remove the last paragraph of a doc. If this is the case,
                    // just clear the element.
                    if (element.getNextSibling()) {
                        element.removeFromParent();
                    } else {
                        element.clear();
                    }
                }
            }
        }
    } else {
        const cursor = DocumentApp.getActiveDocument().getCursor();
        const surroundingText = cursor.getSurroundingText().getText();
        const surroundingTextOffset = cursor.getSurroundingTextOffset();

        // If the cursor follows or preceds a non-space character, insert a space
        // between the character and the translation. Otherwise, just insert the
        // translation.
        if (surroundingTextOffset > 0) {
            if (surroundingText.charAt(surroundingTextOffset - 1) !== ' ') {
                newText = ' ' + newText;
            }
        }
        if (surroundingTextOffset < surroundingText.length) {
            if (surroundingText.charAt(surroundingTextOffset) !== ' ') {
                newText += ' ';
            }
        }
        cursor.insertText(newText);
    }
}
