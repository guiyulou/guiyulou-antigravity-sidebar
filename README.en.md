# guiyulou-antigravity-sidebar 1.0

[简体中文](./README.md) · **English**

**Author**　西塞山的鳜鱼篓

## Demo

https://github.com/user-attachments/assets/8553982d-9a69-4581-98dd-dd7967d631d5

## Seven highlights

- **Find files at a glance.** The sidebar shows your project’s folder structure. Browse by folder or search by filename.
- **Edit right in the sidebar.** Make changes to Markdown, LaTeX, or code as you read. Click `Save` to update the original file.
- **Discuss the exact cell you selected.** Select “30 minutes” in Friday’s row, write “Change Friday to 100 minutes” and click `Add to chat`. The `1` beside the cell and `[Ref 1]` in the chat box point to the same selection. Sending the message clears the input box. To delete the annotations, click `Clear all` and confirm.
- **Read in full screen with one click.** Click the full-screen button in the upper-right corner to give a wide table or a PDF page the full width of the window.
- **Read the PDF on the left, edit its source on the right.** Open the PDF and its LaTeX source side by side, then expand both to full screen. Compare each row of the typeset table with the line of source that produced it.
- **Keep chatting in full screen.** Click `Chat` to open the input box, click again to show the conversation history, and click once more to close the chat. As in the demo, you can send “Please make the edit” with both the PDF and its source still in view.
- **Refresh without losing your place.** Recompile and refresh the PDF. Friday’s value on page two changes from 30 to 100 minutes, and you can keep reading from the same row.

## Installation

Download the [guiyulou-antigravity-sidebar 1.0 installation package](./guiyulou-antigravity-sidebar-1.0.zip?raw=1) and ask your AI assistant to install it.

For the Windows version of Antigravity, ask the assistant, “Please adapt this plugin for Windows and install it for me.” The plugin has not yet been tested on Windows.

## Reading and annotations

- **Open files.** Browse your workspace in the file tree on the left or search by filename. You can open up to eight tabs at once. To read two files side by side, drag a tab or a file from the tree onto the right half of the document area. Click `Refresh` in the toolbar to reload the current file.
- **Read and edit.** Zoom in or out on a PDF and annotate selected text. For Markdown, switch between `Read`, `Live`, and `Source` views. You can edit code and plain text directly. Click `Save` to write your changes back to the original file.
- **Preview HTML.** Opening an HTML file immediately runs the page’s scripts, so interactive charts load along with the page. **Only open HTML files you wrote or trust in the sidebar.** The preview has the same access permissions as the sidebar. If a file comes from an unfamiliar source, inspect it in a text editor first.
- **Add a comment.** Select text in the document, click `Comment`, write your note, then click `Add to chat`. A number appears beside the selection, and the plugin tries to insert a reference such as `[Ref 1] Please check the units` into the chat box. You can edit the message before sending it.
- **Manage annotations.** Click a number in the document to edit or delete its comment. Open `Notes` in the toolbar to see the current round of annotations. Click an entry to jump back to the text it refers to. After you send a message that includes a reference, numbering starts again at `1` for the next round. `Clear all` deletes annotations from the current and all previous rounds.
- **View chat in the sidebar.** With the sidebar maximized, click `Chat` to show the usual chat input box. Click again to expand the conversation history, then once more to close the chat. You can also select text in the expanded conversation and add a comment.

## License

The plugin’s original code and documentation are licensed under the MIT License. The copyright holder is 西塞山的鳜鱼篓. When using, modifying, or distributing the software, retain the copyright notice and license text. [MIT License](LICENSE)

The installation package includes PDF.js, markdown-it, and CodeMirror, each under its own license. The browser build of markdown-it also retains the attribution notices for its bundled components. [Third-party licenses and notices](guiyulou-antigravity-sidebar/LICENSES/)
