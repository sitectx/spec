import { writeLine } from "../output.js";

export function registerVersionCommand(program, version) {
  program
    .command("version")
    .description("Print the SiteCTX CLI version.")
    .action(() => {
      writeLine(`SiteCTX CLI ${version}`);
    });
}
