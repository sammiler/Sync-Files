declare module "adm-zip" {
    class AdmZip {
        constructor(filePath?: string);
        getEntries(): ZipEntry[];
        extractAllTo(outputPath: string, overwrite?: boolean): void;
        toBuffer(): Buffer;
        writeZip(targetFileName?: string): void;
    }

    class ZipEntry {
        entryName: string;
        getData(): Buffer;
    }

    export = AdmZip;
}
