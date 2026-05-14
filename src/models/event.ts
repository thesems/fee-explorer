import "reflect-metadata";
import { getModelForClass, index, prop } from "@typegoose/typegoose";

@index(
  { chainId: 1, contractAddress: 1, blockNumber: 1, logIndex: 1 },
  { unique: true },
)
@index({ chainId: 1, contractAddress: 1, blockNumber: 1 })
@index({ chainId: 1, contractAddress: 1, integrator: 1, blockNumber: 1 })
export class FeeEvent {
  @prop({ required: true, type: () => Number })
  public chainId!: number;

  @prop({ required: true, type: () => String, lowercase: true })
  public contractAddress!: string;

  @prop({ required: true, type: () => String, lowercase: true })
  public tokenAddress!: string;

  @prop({ required: true, type: () => String, lowercase: true })
  public integrator!: string;

  @prop({ required: true, type: () => String })
  public integratorFee!: string;

  @prop({ required: true, type: () => String })
  public lifiFee!: string;

  @prop({ required: true, type: () => Number })
  public blockNumber!: number;

  @prop({ required: true, type: () => Number })
  public logIndex!: number;

  @prop({ required: true, type: () => String, lowercase: true })
  public transactionHash!: string;

  @prop({ required: true, type: () => Date })
  public timestamp!: Date;

  @prop({ required: true, type: () => Date, default: () => new Date() })
  public createdAt!: Date;
}

export const FeeEventModel = getModelForClass(FeeEvent, {
  schemaOptions: {
    collection: "events",
  },
});
