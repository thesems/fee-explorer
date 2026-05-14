import "reflect-metadata";
import { getModelForClass, index, prop } from "@typegoose/typegoose";

@index({ chainId: 1, contractId: 1 }, { unique: true })
export class IngestionProgress {
  @prop({ required: true, type: () => Number })
  public chainId!: number;

  @prop({ required: true, type: () => String, lowercase: true })
  public contractId!: string;

  @prop({ required: true, type: () => Number })
  public lastProcessedBlock!: number;

  @prop({ required: true, type: () => Date, default: () => new Date() })
  public updatedAt!: Date;
}

export const IngestionProgressModel = getModelForClass(IngestionProgress, {
  schemaOptions: {
    collection: "progress",
  },
});
