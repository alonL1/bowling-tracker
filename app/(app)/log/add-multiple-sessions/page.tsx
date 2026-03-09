import RecordUploadSection from "../../../components/features/log/RecordUploadSection";

export default function AddMultipleSessionsPage() {
  return (
    <RecordUploadSection
      title="Add Multiple Sessions"
      mode="auto"
      submitHelperText="Select up to 100 images and they will automatically be sorted into sessions and recorded."
    />
  );
}
